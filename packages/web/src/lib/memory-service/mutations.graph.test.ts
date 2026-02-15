import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

type DbClient = ReturnType<typeof createClient>

const originalGraphMappingEnabled = process.env.GRAPH_MAPPING_ENABLED
const testDatabases: DbClient[] = []

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "mutations-graph.db")}` })
  testDatabases.push(db)

  await db.execute(
    `CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      memory_layer TEXT,
      expires_at TEXT,
      scope TEXT NOT NULL,
      project_id TEXT,
      user_id TEXT,
      tags TEXT,
      paths TEXT,
      category TEXT,
      metadata TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  )

  return db
}

function restoreGraphMappingFlag(): void {
  if (originalGraphMappingEnabled === undefined) {
    delete process.env.GRAPH_MAPPING_ENABLED
  } else {
    process.env.GRAPH_MAPPING_ENABLED = originalGraphMappingEnabled
  }
}

async function loadMutationsModule(graphEnabled: boolean) {
  vi.resetModules()
  process.env.GRAPH_MAPPING_ENABLED = graphEnabled ? "true" : "false"
  return import("./mutations")
}

async function scalarCount(turso: DbClient, sql: string, args: (string | number | null)[] = []): Promise<number> {
  const result = await turso.execute({ sql, args })
  return Number(result.rows[0]?.count ?? 0)
}

async function tableExists(turso: DbClient, tableName: string): Promise<boolean> {
  const count = await scalarCount(
    turso,
    `SELECT COUNT(*) as count
     FROM sqlite_master
     WHERE type = 'table' AND name = ?`,
    [tableName]
  )
  return count > 0
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
  restoreGraphMappingFlag()
  vi.doUnmock("./graph/upsert")
  vi.resetModules()
})

describe("memory mutations graph integration", () => {
  it("skips graph side effects when GRAPH_MAPPING_ENABLED is false", async () => {
    const db = await setupDb("memories-mutations-graph-off")
    const { addMemoryPayload, editMemoryPayload, forgetMemoryPayload } = await loadMutationsModule(false)

    const added = await addMemoryPayload({
      turso: db,
      args: {
        content: "Graph disabled memory",
        type: "note",
        tags: ["billing"],
        category: "ops",
      },
      projectId: "github.com/webrenew/memories",
      userId: "user-off",
      nowIso: "2026-02-11T18:00:00.000Z",
    })

    await editMemoryPayload({
      turso: db,
      args: {
        id: added.data.id,
        tags: ["migrations"],
        category: "infra",
      },
      userId: "user-off",
      nowIso: "2026-02-11T18:01:00.000Z",
    })

    await forgetMemoryPayload({
      turso: db,
      args: { id: added.data.id },
      userId: "user-off",
      nowIso: "2026-02-11T18:02:00.000Z",
    })

    expect(await tableExists(db, "graph_nodes")).toBe(false)
    expect(await tableExists(db, "graph_edges")).toBe(false)
    expect(await tableExists(db, "memory_node_links")).toBe(false)

    const deletedRows = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM memories WHERE id = ? AND deleted_at IS NOT NULL",
      [added.data.id]
    )
    expect(deletedRows).toBe(1)
  })

  it("syncs graph mappings across add/edit/forget when GRAPH_MAPPING_ENABLED is true", async () => {
    const db = await setupDb("memories-mutations-graph-on")
    const { addMemoryPayload, editMemoryPayload, forgetMemoryPayload } = await loadMutationsModule(true)

    const added = await addMemoryPayload({
      turso: db,
      args: {
        content: "Working memory for graph sync",
        type: "note",
        layer: "working",
        tags: ["billing"],
        category: "ops",
      },
      projectId: "github.com/webrenew/memories",
      userId: "user-on",
      nowIso: "2026-02-11T18:10:00.000Z",
    })

    expect(await tableExists(db, "graph_nodes")).toBe(true)
    expect(await tableExists(db, "graph_edges")).toBe(true)
    expect(await tableExists(db, "memory_node_links")).toBe(true)

    const billingLinks = await scalarCount(
      db,
      `SELECT COUNT(*) as count
       FROM memory_node_links l
       JOIN graph_nodes n ON n.id = l.node_id
       WHERE l.memory_id = ? AND n.node_type = 'topic' AND n.node_key = 'billing'`,
      [added.data.id]
    )
    expect(billingLinks).toBe(1)

    await editMemoryPayload({
      turso: db,
      args: {
        id: added.data.id,
        layer: "long_term",
        tags: ["migrations"],
      },
      userId: "user-on",
      nowIso: "2026-02-11T18:11:00.000Z",
    })

    const staleBillingLinks = await scalarCount(
      db,
      `SELECT COUNT(*) as count
       FROM memory_node_links l
       JOIN graph_nodes n ON n.id = l.node_id
       WHERE l.memory_id = ? AND n.node_type = 'topic' AND n.node_key = 'billing'`,
      [added.data.id]
    )
    const migrationsLinks = await scalarCount(
      db,
      `SELECT COUNT(*) as count
       FROM memory_node_links l
       JOIN graph_nodes n ON n.id = l.node_id
       WHERE l.memory_id = ? AND n.node_type = 'topic' AND n.node_key = 'migrations'`,
      [added.data.id]
    )
    expect(staleBillingLinks).toBe(0)
    expect(migrationsLinks).toBe(1)

    const edgeExpiryCounts = await db.execute({
      sql: `SELECT
              COUNT(*) as total,
              SUM(CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END) as without_expiry
            FROM graph_edges
            WHERE evidence_memory_id = ?`,
      args: [added.data.id],
    })
    const totalEdges = Number(edgeExpiryCounts.rows[0]?.total ?? 0)
    const edgesWithoutExpiry = Number(edgeExpiryCounts.rows[0]?.without_expiry ?? 0)
    expect(totalEdges).toBeGreaterThan(0)
    expect(edgesWithoutExpiry).toBe(totalEdges)

    await forgetMemoryPayload({
      turso: db,
      args: { id: added.data.id },
      userId: "user-on",
      nowIso: "2026-02-11T18:12:00.000Z",
    })

    const remainingLinks = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM memory_node_links WHERE memory_id = ?",
      [added.data.id]
    )
    const remainingEdges = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM graph_edges WHERE evidence_memory_id = ?",
      [added.data.id]
    )
    expect(remainingLinks).toBe(0)
    expect(remainingEdges).toBe(0)
  })

  it("scopes forget to working-layer memories when requested", async () => {
    const db = await setupDb("memories-mutations-forget-working-scope")
    const { forgetMemoryPayload } = await loadMutationsModule(false)

    await db.execute({
      sql: `INSERT INTO memories (
              id, content, type, memory_layer, expires_at, scope, project_id, user_id,
              tags, paths, category, metadata, deleted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "long-1",
        "Long-term note that should not be deleted by transcript eviction",
        "note",
        "long_term",
        null,
        "global",
        null,
        "user-scope",
        null,
        null,
        null,
        null,
        null,
        "2026-02-11T19:00:00.000Z",
        "2026-02-11T19:00:00.000Z",
      ],
    })

    await forgetMemoryPayload({
      turso: db,
      args: { id: "long-1" },
      userId: "user-scope",
      nowIso: "2026-02-11T19:05:00.000Z",
      onlyWorkingLayer: true,
    })

    const stillActive = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM memories WHERE id = ? AND deleted_at IS NULL",
      ["long-1"]
    )
    expect(stillActive).toBe(1)
  })

  it("scopes bulk forget to working-layer memories when requested", async () => {
    const db = await setupDb("memories-mutations-bulk-working-scope")
    const { bulkForgetMemoriesPayload } = await loadMutationsModule(false)

    await db.execute({
      sql: `INSERT INTO memories (
              id, content, type, memory_layer, expires_at, scope, project_id, user_id,
              tags, paths, category, metadata, deleted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "working-1",
        "Ephemeral chat context",
        "note",
        "working",
        "2026-02-11T20:00:00.000Z",
        "global",
        null,
        "user-scope",
        null,
        null,
        null,
        null,
        null,
        "2026-02-11T19:00:00.000Z",
        "2026-02-11T19:00:00.000Z",
      ],
    })
    await db.execute({
      sql: `INSERT INTO memories (
              id, content, type, memory_layer, expires_at, scope, project_id, user_id,
              tags, paths, category, metadata, deleted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "long-2",
        "Long-term preference",
        "note",
        "long_term",
        null,
        "global",
        null,
        "user-scope",
        null,
        null,
        null,
        null,
        null,
        "2026-02-11T19:00:00.000Z",
        "2026-02-11T19:00:00.000Z",
      ],
    })

    const result = await bulkForgetMemoriesPayload({
      turso: db,
      args: { all: true },
      userId: "user-scope",
      nowIso: "2026-02-11T19:10:00.000Z",
      onlyWorkingLayer: true,
    })

    expect(result.data.count).toBe(1)
    const workingDeleted = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM memories WHERE id = ? AND deleted_at IS NOT NULL",
      ["working-1"]
    )
    const longStillActive = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM memories WHERE id = ? AND deleted_at IS NULL",
      ["long-2"]
    )
    expect(workingDeleted).toBe(1)
    expect(longStillActive).toBe(1)
  })

  it("scopes vacuum to soft-deleted working-layer memories when requested", async () => {
    const db = await setupDb("memories-mutations-vacuum-working-scope")
    const { vacuumMemoriesPayload } = await loadMutationsModule(false)

    await db.execute({
      sql: `INSERT INTO memories (
              id, content, type, memory_layer, expires_at, scope, project_id, user_id,
              tags, paths, category, metadata, deleted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "working-deleted",
        "Deleted ephemeral chat transcript",
        "note",
        "working",
        "2026-02-11T20:00:00.000Z",
        "global",
        null,
        "user-scope",
        null,
        null,
        null,
        null,
        "2026-02-11T19:11:00.000Z",
        "2026-02-11T19:00:00.000Z",
        "2026-02-11T19:11:00.000Z",
      ],
    })
    await db.execute({
      sql: `INSERT INTO memories (
              id, content, type, memory_layer, expires_at, scope, project_id, user_id,
              tags, paths, category, metadata, deleted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "long-deleted",
        "Deleted long-term memory",
        "note",
        "long_term",
        null,
        "global",
        null,
        "user-scope",
        null,
        null,
        null,
        null,
        "2026-02-11T19:11:00.000Z",
        "2026-02-11T19:00:00.000Z",
        "2026-02-11T19:11:00.000Z",
      ],
    })

    const result = await vacuumMemoriesPayload({
      turso: db,
      userId: "user-scope",
      onlyWorkingLayer: true,
    })

    expect(result.data.purged).toBe(1)
    const workingGone = await scalarCount(db, "SELECT COUNT(*) as count FROM memories WHERE id = ?", ["working-deleted"])
    const longStillExists = await scalarCount(db, "SELECT COUNT(*) as count FROM memories WHERE id = ?", ["long-deleted"])
    expect(workingGone).toBe(0)
    expect(longStillExists).toBe(1)
  })

  it("keeps memory writes successful if graph sync fails", async () => {
    const db = await setupDb("memories-mutations-graph-fail-open")

    const syncMemoryGraphMapping = vi.fn(async () => {
      throw new Error("sync failed")
    })
    const removeMemoryGraphMapping = vi.fn(async () => {
      throw new Error("remove failed")
    })

    vi.resetModules()
    process.env.GRAPH_MAPPING_ENABLED = "true"
    vi.doMock("./graph/upsert", () => ({
      syncMemoryGraphMapping,
      removeMemoryGraphMapping,
    }))

    const { addMemoryPayload, editMemoryPayload, forgetMemoryPayload } = await import("./mutations")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const added = await addMemoryPayload({
      turso: db,
      args: {
        content: "Should still persist if graph sync fails",
        type: "note",
      },
      projectId: undefined,
      userId: "user-fail-open",
      nowIso: "2026-02-11T18:20:00.000Z",
    })

    const insertedRows = await scalarCount(db, "SELECT COUNT(*) as count FROM memories WHERE id = ?", [added.data.id])
    expect(insertedRows).toBe(1)

    await editMemoryPayload({
      turso: db,
      args: {
        id: added.data.id,
        content: "Still editable despite graph failure",
      },
      userId: "user-fail-open",
      nowIso: "2026-02-11T18:21:00.000Z",
    })

    const updatedRows = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM memories WHERE id = ? AND content = ?",
      [added.data.id, "Still editable despite graph failure"]
    )
    expect(updatedRows).toBe(1)

    await forgetMemoryPayload({
      turso: db,
      args: { id: added.data.id },
      userId: "user-fail-open",
      nowIso: "2026-02-11T18:22:00.000Z",
    })

    const deletedRows = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM memories WHERE id = ? AND deleted_at IS NOT NULL",
      [added.data.id]
    )
    expect(deletedRows).toBe(1)

    expect(syncMemoryGraphMapping).toHaveBeenCalledTimes(2)
    expect(removeMemoryGraphMapping).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(3)
    errorSpy.mockRestore()
  })

  it("rejects empty edit content", async () => {
    const db = await setupDb("memories-mutations-edit-content-validation")
    const { addMemoryPayload, editMemoryPayload } = await loadMutationsModule(false)

    const added = await addMemoryPayload({
      turso: db,
      args: {
        content: "Editable memory",
        type: "note",
      },
      userId: "user-validation",
      nowIso: "2026-02-11T18:30:00.000Z",
    })

    await expect(
      editMemoryPayload({
        turso: db,
        args: { id: added.data.id, content: "   " },
        userId: "user-validation",
        nowIso: "2026-02-11T18:31:00.000Z",
      })
    ).rejects.toMatchObject({
      detail: expect.objectContaining({
        code: "MEMORY_CONTENT_REQUIRED",
        status: 400,
      }),
    })
  })

  it("returns not_found when edit target does not exist", async () => {
    const db = await setupDb("memories-mutations-edit-not-found")
    const { editMemoryPayload } = await loadMutationsModule(false)

    await expect(
      editMemoryPayload({
        turso: db,
        args: { id: "missing", content: "test" },
        userId: "user-missing",
        nowIso: "2026-02-11T18:40:00.000Z",
      })
    ).rejects.toMatchObject({
      detail: expect.objectContaining({
        code: "MEMORY_NOT_FOUND",
        status: 404,
      }),
    })
  })

  it("returns not_found when forget target does not exist", async () => {
    const db = await setupDb("memories-mutations-forget-not-found")
    const { forgetMemoryPayload } = await loadMutationsModule(false)

    await expect(
      forgetMemoryPayload({
        turso: db,
        args: { id: "missing" },
        userId: "user-missing",
        nowIso: "2026-02-11T18:50:00.000Z",
      })
    ).rejects.toMatchObject({
      detail: expect.objectContaining({
        code: "MEMORY_NOT_FOUND",
        status: 404,
      }),
    })
  })
})
