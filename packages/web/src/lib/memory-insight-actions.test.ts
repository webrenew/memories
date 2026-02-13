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
  const db = createClient({ url: `file:${join(dbDir, "memory-insight-actions.db")}` })
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
    )`,
  )

  return db
}

async function insertMemory(
  db: DbClient,
  row: {
    id: string
    content: string
    type?: string
    tags?: string | null
    createdAt?: string
    updatedAt?: string
    projectId?: string | null
  },
): Promise<void> {
  const createdAt = row.createdAt ?? "2026-02-13T00:00:00.000Z"
  const updatedAt = row.updatedAt ?? createdAt
  await db.execute({
    sql: `INSERT INTO memories (
            id, content, type, memory_layer, expires_at, scope, project_id, user_id, tags,
            paths, category, metadata, deleted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.content,
      row.type ?? "rule",
      row.type === "rule" ? "rule" : "long_term",
      null,
      row.projectId ? "project" : "global",
      row.projectId ?? null,
      null,
      row.tags ?? null,
      null,
      null,
      null,
      null,
      createdAt,
      updatedAt,
    ],
  })
}

async function rowScalar(
  db: DbClient,
  sql: string,
  args: Array<string | number | null> = [],
): Promise<number> {
  const result = await db.execute({ sql, args })
  return Number(result.rows[0]?.count ?? 0)
}

function csvToSet(value: string | null | undefined): Set<string> {
  if (!value) return new Set()
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )
}

function restoreGraphFlag(): void {
  if (originalGraphMappingEnabled === undefined) {
    delete process.env.GRAPH_MAPPING_ENABLED
  } else {
    process.env.GRAPH_MAPPING_ENABLED = originalGraphMappingEnabled
  }
}

async function loadActionsModule(graphEnabled = false) {
  vi.resetModules()
  process.env.GRAPH_MAPPING_ENABLED = graphEnabled ? "true" : "false"
  return import("./memory-insight-actions")
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
  restoreGraphFlag()
  vi.resetModules()
})

describe("memory insight actions", () => {
  it("archives memories for archive actions", async () => {
    const db = await setupDb("memory-insight-archive")
    const { applyMemoryInsightAction } = await loadActionsModule(false)

    await insertMemory(db, { id: "rule-old-1", content: "Old rule one" })
    await insertMemory(db, { id: "rule-old-2", content: "Old rule two" })

    const result = await applyMemoryInsightAction(db, {
      kind: "archive",
      memoryIds: ["rule-old-1", "rule-old-2"],
      nowIso: "2026-02-13T10:00:00.000Z",
    })

    expect(result.kind).toBe("archive")
    expect(result.archivedIds.sort()).toEqual(["rule-old-1", "rule-old-2"])
    expect(result.appliedCount).toBe(2)

    const deleted = await rowScalar(
      db,
      "SELECT COUNT(*) as count FROM memories WHERE id IN (?, ?) AND deleted_at IS NOT NULL",
      ["rule-old-1", "rule-old-2"],
    )
    expect(deleted).toBe(2)
  })

  it("applies relabel actions by merging proposed tags", async () => {
    const db = await setupDb("memory-insight-relabel")
    const { applyMemoryInsightAction } = await loadActionsModule(false)

    await insertMemory(db, {
      id: "note-1",
      content: "Need better labels",
      type: "note",
      tags: "ops",
    })

    const result = await applyMemoryInsightAction(db, {
      kind: "relabel",
      memoryIds: ["note-1"],
      proposedTags: ["Billing", "ops", "quality"],
      nowIso: "2026-02-13T11:00:00.000Z",
    })

    expect(result.kind).toBe("relabel")
    expect(result.updatedTags).toHaveLength(1)

    const read = await db.execute({
      sql: "SELECT tags FROM memories WHERE id = ?",
      args: ["note-1"],
    })

    const tags = csvToSet((read.rows[0]?.tags as string | null | undefined) ?? null)
    expect(tags).toEqual(new Set(["ops", "billing", "quality"]))
  })

  it("merges duplicate memories into newest canonical memory", async () => {
    const db = await setupDb("memory-insight-merge")
    const { applyMemoryInsightAction } = await loadActionsModule(false)

    await insertMemory(db, {
      id: "dup-old",
      content: "Legacy duplicate",
      type: "rule",
      tags: "legacy",
      updatedAt: "2026-02-10T00:00:00.000Z",
    })
    await insertMemory(db, {
      id: "dup-new",
      content: "Current canonical duplicate",
      type: "rule",
      tags: "current",
      updatedAt: "2026-02-13T00:00:00.000Z",
    })
    await insertMemory(db, {
      id: "dup-mid",
      content: "Another duplicate",
      type: "rule",
      tags: "security",
      updatedAt: "2026-02-12T00:00:00.000Z",
    })

    const result = await applyMemoryInsightAction(db, {
      kind: "merge",
      memoryIds: ["dup-old", "dup-new", "dup-mid"],
      nowIso: "2026-02-13T12:00:00.000Z",
    })

    expect(result.kind).toBe("merge")
    expect(result.canonicalId).toBe("dup-new")
    expect(new Set(result.archivedIds)).toEqual(new Set(["dup-old", "dup-mid"]))

    const deleted = await rowScalar(
      db,
      "SELECT COUNT(*) as count FROM memories WHERE id IN (?, ?) AND deleted_at IS NOT NULL",
      ["dup-old", "dup-mid"],
    )
    expect(deleted).toBe(2)

    const canonical = await db.execute({
      sql: "SELECT tags, deleted_at FROM memories WHERE id = ?",
      args: ["dup-new"],
    })

    expect(canonical.rows[0]?.deleted_at).toBeNull()
    const tags = csvToSet((canonical.rows[0]?.tags as string | null | undefined) ?? null)
    expect(tags).toEqual(new Set(["legacy", "current", "security"]))
  })
})
