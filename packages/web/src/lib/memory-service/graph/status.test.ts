import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensureGraphTables } from "./upsert"
import { getGraphStatusPayload } from "./status"
import { recordGraphRolloutMetric, setGraphRolloutConfig } from "./rollout"

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

  it("syncs unmapped memories into graph tables on status reads", async () => {
    const db = await setupDb("memories-graph-status-opportunistic-sync")
    await ensureGraphTables(db)

    await db.execute(
      `CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        memory_layer TEXT,
        expires_at TEXT,
        project_id TEXT,
        user_id TEXT,
        tags TEXT,
        category TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      )`
    )

    await db.execute({
      sql: `INSERT INTO memories (
              id, type, memory_layer, expires_at, project_id, user_id, tags, category, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "mem-unmapped-1",
        "rule",
        null,
        null,
        "github.com/WebRenew/memories",
        null,
        "graph,rollout,hybrid_graph",
        "graph-ui",
        "2026-02-12T00:00:00.000Z",
        "2026-02-12T00:00:00.000Z",
        null,
      ],
    })

    const payload = await getGraphStatusPayload({
      turso: db,
      nowIso: "2026-02-12T00:10:00.000Z",
      topNodesLimit: 10,
    })

    expect(payload.health).toBe("ok")
    expect(payload.counts.nodes).toBeGreaterThan(0)
    expect(payload.counts.edges).toBeGreaterThan(0)
    expect(payload.counts.memoryLinks).toBeGreaterThan(0)
    expect(payload.topConnectedNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeType: "repo",
          nodeKey: "github.com/WebRenew/memories",
        }),
      ])
    )

    const linksResult = await db.execute({
      sql: "SELECT COUNT(*) as count FROM memory_node_links WHERE memory_id = ?",
      args: ["mem-unmapped-1"],
    })
    expect(Number(linksResult.rows[0]?.count ?? 0)).toBeGreaterThan(0)
  })

  it("can skip opportunistic mapping sync for faster read-only status", async () => {
    const db = await setupDb("memories-graph-status-no-sync")
    await ensureGraphTables(db)

    await db.execute(
      `CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        memory_layer TEXT,
        expires_at TEXT,
        project_id TEXT,
        user_id TEXT,
        tags TEXT,
        category TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      )`
    )

    await db.execute({
      sql: `INSERT INTO memories (
              id, type, memory_layer, expires_at, project_id, user_id, tags, category, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "mem-unmapped-no-sync",
        "rule",
        null,
        null,
        "github.com/WebRenew/memories",
        null,
        "graph,rollout,hybrid_graph",
        "graph-ui",
        "2026-02-12T00:00:00.000Z",
        "2026-02-12T00:00:00.000Z",
        null,
      ],
    })

    const payload = await getGraphStatusPayload({
      turso: db,
      nowIso: "2026-02-12T00:10:00.000Z",
      topNodesLimit: 10,
      syncMappings: false,
    })

    expect(payload.health).toBe("ok")
    expect(payload.counts.memoryLinks).toBe(0)

    const linksResult = await db.execute({
      sql: "SELECT COUNT(*) as count FROM memory_node_links WHERE memory_id = ?",
      args: ["mem-unmapped-no-sync"],
    })
    expect(Number(linksResult.rows[0]?.count ?? 0)).toBe(0)
  })

  it("raises fallback alarms when rollout metrics degrade", async () => {
    const db = await setupDb("memories-graph-status-alarms")
    await ensureGraphTables(db)
    await setGraphRolloutConfig(db, {
      mode: "canary",
      nowIso: "2026-02-12T00:00:00.000Z",
      updatedBy: "user-1",
    })

    for (let index = 0; index < 20; index += 1) {
      const fallbackTriggered = index < 4
      await recordGraphRolloutMetric(db, {
        nowIso: `2026-02-12T00:${index.toString().padStart(2, "0")}:00.000Z`,
        mode: "canary",
        requestedStrategy: "hybrid_graph",
        appliedStrategy: fallbackTriggered ? "baseline" : "hybrid_graph",
        shadowExecuted: false,
        baselineCandidates: 3,
        graphCandidates: 2,
        graphExpandedCount: fallbackTriggered ? 0 : 1,
        totalCandidates: fallbackTriggered ? 3 : 4,
        fallbackTriggered,
        fallbackReason: fallbackTriggered ? "graph_expansion_error" : null,
      })
    }

    const payload = await getGraphStatusPayload({
      turso: db,
      nowIso: "2026-02-12T01:00:00.000Z",
      topNodesLimit: 10,
    })

    expect(payload.rollout.mode).toBe("canary")
    expect(payload.shadowMetrics.totalRequests).toBe(20)
    expect(payload.shadowMetrics.fallbackRate).toBe(0.2)
    expect(payload.alarms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "HIGH_FALLBACK_RATE",
          severity: "critical",
        }),
        expect.objectContaining({
          code: "GRAPH_EXPANSION_ERRORS",
          severity: "critical",
        }),
      ])
    )
    expect(payload.recentErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "HIGH_FALLBACK_RATE",
          source: "alarm",
        }),
      ])
    )
  })
})
