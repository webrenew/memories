import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensureGraphTables } from "./upsert"
import { getGraphStatusPayload } from "./status"

type DbClient = ReturnType<typeof createClient>

const testDatabases: DbClient[] = []

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "graph-status.db")}` })
  testDatabases.push(db)
  return db
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
})

describe("getGraphStatusPayload", () => {
  it("returns schema_missing when graph tables do not exist", async () => {
    const db = await setupDb("memories-graph-status-missing")

    const payload = await getGraphStatusPayload({
      turso: db,
      nowIso: "2026-02-12T00:00:00.000Z",
      topNodesLimit: 10,
    })

    expect(payload.health).toBe("schema_missing")
    expect(payload.tables).toEqual({
      graphNodes: false,
      graphEdges: false,
      memoryNodeLinks: false,
    })
    expect(payload.counts.nodes).toBe(0)
    expect(payload.counts.edges).toBe(0)
    expect(payload.counts.memoryLinks).toBe(0)
    expect(payload.topConnectedNodes).toEqual([])
    expect(payload.recentErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "GRAPH_SCHEMA_MISSING",
          source: "schema",
        }),
      ])
    )
  })

  it("reports counts and top connected nodes when schema exists", async () => {
    const db = await setupDb("memories-graph-status-ok")
    await ensureGraphTables(db)

    await db.execute({
      sql: `INSERT INTO graph_nodes (id, node_type, node_key, label, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "node-auth",
        "topic",
        "auth",
        "Auth",
        null,
        "2026-02-12T00:00:00.000Z",
        "2026-02-12T00:00:00.000Z",
        "node-billing",
        "topic",
        "billing",
        "Billing",
        null,
        "2026-02-12T00:00:00.000Z",
        "2026-02-12T00:00:00.000Z",
        "node-user",
        "user",
        "user-1",
        "User 1",
        null,
        "2026-02-12T00:00:00.000Z",
        "2026-02-12T00:00:00.000Z",
      ],
    })

    await db.execute({
      sql: `INSERT INTO graph_edges (
              id, from_node_id, to_node_id, edge_type, weight, confidence, evidence_memory_id, expires_at, created_at, updated_at
            ) VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "edge-active",
        "node-auth",
        "node-billing",
        "mentions",
        1,
        1,
        "mem-1",
        null,
        "2026-02-12T00:00:00.000Z",
        "2026-02-12T00:00:00.000Z",
        "edge-expired",
        "node-user",
        "node-auth",
        "authored_by",
        1,
        1,
        "mem-2",
        "2026-02-11T00:00:00.000Z",
        "2026-02-12T00:00:00.000Z",
        "2026-02-12T00:00:00.000Z",
      ],
    })

    await db.execute({
      sql: `INSERT INTO memory_node_links (memory_id, node_id, role, created_at)
            VALUES
            (?, ?, ?, ?),
            (?, ?, ?, ?),
            (?, ?, ?, ?)`,
      args: [
        "mem-1",
        "node-auth",
        "tag",
        "2026-02-12T00:00:00.000Z",
        "mem-2",
        "node-auth",
        "tag",
        "2026-02-12T00:00:00.000Z",
        "mem-2",
        "node-user",
        "subject",
        "2026-02-12T00:00:00.000Z",
      ],
    })

    const payload = await getGraphStatusPayload({
      turso: db,
      nowIso: "2026-02-12T00:00:00.000Z",
      topNodesLimit: 5,
    })

    expect(payload.health).toBe("ok")
    expect(payload.tables).toEqual({
      graphNodes: true,
      graphEdges: true,
      memoryNodeLinks: true,
    })
    expect(payload.counts).toEqual({
      nodes: 3,
      edges: 2,
      memoryLinks: 3,
      activeEdges: 1,
      expiredEdges: 1,
      orphanNodes: 0,
    })
    expect(payload.topConnectedNodes[0]).toMatchObject({
      nodeType: "topic",
      nodeKey: "auth",
      memoryLinks: 2,
      outboundEdges: 1,
      inboundEdges: 0,
      degree: 3,
    })
    expect(payload.recentErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EXPIRED_EDGES_PRESENT",
          source: "ttl",
        }),
      ])
    )
  })
})
