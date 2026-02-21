import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ensureGraphTables } from "./graph/upsert"

type DbClient = ReturnType<typeof createClient>

const originalGraphRetrievalEnabled = process.env.GRAPH_RETRIEVAL_ENABLED
const databases: DbClient[] = []

function restoreGraphRetrievalFlag(): void {
  if (originalGraphRetrievalEnabled === undefined) {
    delete process.env.GRAPH_RETRIEVAL_ENABLED
  } else {
    process.env.GRAPH_RETRIEVAL_ENABLED = originalGraphRetrievalEnabled
  }
}

async function loadQueriesModule(graphRetrievalEnabled: boolean) {
  vi.resetModules()
  process.env.GRAPH_RETRIEVAL_ENABLED = graphRetrievalEnabled ? "true" : "false"
  return import("./queries")
}

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "queries-graph.db")}` })
  databases.push(db)

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

  await ensureGraphTables(db)
  return db
}

async function seedGraphRetrievalFixture(db: DbClient): Promise<void> {
  await db.execute({
    sql: `INSERT INTO memories (
            id, content, type, memory_layer, expires_at, scope, project_id, user_id,
            tags, paths, category, metadata, deleted_at, created_at, updated_at
          ) VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "w1",
      "Current auth migration state",
      "note",
      "working",
      "2099-01-01T00:00:00.000Z",
      "global",
      null,
      null,
      "auth",
      null,
      null,
      null,
      null,
      "2026-02-11T10:00:00.000Z",
      "2026-02-11T10:00:00.000Z",
      "l-base",
      "Stable architecture baseline",
      "decision",
      "long_term",
      null,
      "global",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "2026-02-11T09:00:00.000Z",
      "2026-02-11T09:00:00.000Z",
      "l-graph",
      "Billing reliability incident pattern",
      "fact",
      "long_term",
      null,
      "global",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "2026-02-10T09:00:00.000Z",
      "2026-02-10T09:00:00.000Z",
    ],
  })

  await db.execute({
    sql: `INSERT INTO graph_nodes (id, node_type, node_key, label, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "node:topic:auth",
      "topic",
      "auth",
      "Auth",
      null,
      "2026-02-11T10:00:00.000Z",
      "2026-02-11T10:00:00.000Z",
      "node:topic:billing",
      "topic",
      "billing",
      "Billing",
      null,
      "2026-02-11T10:00:00.000Z",
      "2026-02-11T10:00:00.000Z",
    ],
  })

  await db.execute({
    sql: `INSERT INTO graph_edges (
            id, from_node_id, to_node_id, edge_type, weight, confidence,
            evidence_memory_id, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "edge:auth:billing",
      "node:topic:auth",
      "node:topic:billing",
      "mentions",
      1,
      1,
      "w1",
      null,
      "2026-02-11T10:00:00.000Z",
      "2026-02-11T10:00:00.000Z",
    ],
  })

  await db.execute({
    sql: `INSERT INTO memory_node_links (memory_id, node_id, role, created_at)
          VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    args: [
      "w1",
      "node:topic:auth",
      "tag",
      "2026-02-11T10:00:00.000Z",
      "l-graph",
      "node:topic:billing",
      "tag",
      "2026-02-11T10:00:00.000Z",
    ],
  })
}

async function seedContradictionEdgeFixture(db: DbClient): Promise<void> {
  await db.execute({
    sql: `INSERT INTO graph_nodes (id, node_type, node_key, label, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "graph-node:memory:l-base",
      "memory",
      "l-base",
      "Stable architecture baseline",
      null,
      "2026-02-11T10:00:00.000Z",
      "2026-02-11T10:00:00.000Z",
      "graph-node:memory:l-graph",
      "memory",
      "l-graph",
      "Billing reliability incident pattern",
      null,
      "2026-02-11T10:00:00.000Z",
      "2026-02-11T10:00:00.000Z",
    ],
  })

  await db.execute({
    sql: `INSERT INTO graph_edges (
            id, from_node_id, to_node_id, edge_type, weight, confidence,
            evidence_memory_id, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "edge:l-base:l-graph:contradicts",
      "graph-node:memory:l-base",
      "graph-node:memory:l-graph",
      "contradicts",
      1,
      0.92,
      "l-base",
      null,
      "2026-02-11T10:00:00.000Z",
      "2026-02-11T10:00:00.000Z",
      "edge:l-graph:l-base:contradicts",
      "graph-node:memory:l-graph",
      "graph-node:memory:l-base",
      "contradicts",
      1,
      0.92,
      "l-graph",
      null,
      "2026-02-11T10:00:00.000Z",
      "2026-02-11T10:00:00.000Z",
    ],
  })
}

afterEach(() => {
  for (const db of databases.splice(0, databases.length)) {
    db.close()
  }
  restoreGraphRetrievalFlag()
  vi.resetModules()
})

describe("getContextPayload graph retrieval integration", () => {
  it("adds graph-expanded memories with explainability when hybrid retrieval is enabled", async () => {
    const db = await setupDb("memories-queries-graph-on")
    await seedGraphRetrievalFixture(db)
    await seedContradictionEdgeFixture(db)
    const { getContextPayload } = await loadQueriesModule(true)

    const payload = await getContextPayload({
      turso: db,
      userId: null,
      nowIso: "2026-02-11T11:00:00.000Z",
      query: "",
      limit: 2,
      retrievalStrategy: "hybrid_graph",
      graphDepth: 1,
      graphLimit: 2,
    })

    const ids = payload.data.memories.map((memory) => memory.id)
    expect(ids).toEqual(["w1", "l-base", "l-graph"])

    const graphExpanded = payload.data.memories.find((memory) => memory.id === "l-graph")
    expect(graphExpanded?.graph).toEqual(
      expect.objectContaining({
        whyIncluded: "graph_expansion",
        seedMemoryId: "w1",
        linkedViaNode: "topic:billing",
        edgeType: "mentions",
        hopCount: 1,
      })
    )
    expect(payload.data.trace.strategy).toBe("hybrid_graph")
    expect(payload.data.trace.requestedStrategy).toBe("hybrid_graph")
    expect(payload.data.trace.rolloutMode).toBe("canary")
    expect(payload.data.trace.shadowExecuted).toBe(false)
    expect(payload.data.trace.qualityGateStatus).toBe("insufficient_data")
    expect(payload.data.trace.qualityGateBlocked).toBe(false)
    expect(payload.data.trace.qualityGateReasonCodes).toEqual([])
    expect(payload.data.trace.graphExpandedCount).toBe(1)
    expect(payload.data.trace.conflictCount).toBe(1)
    expect(payload.data.trace.fallbackTriggered).toBe(false)
    expect(payload.data.trace.fallbackReason).toBeNull()
    expect(payload.data.trace.totalCandidates).toBe(3)
    expect(payload.data.conflicts).toEqual([
      {
        memoryAId: "l-base",
        memoryBId: "l-graph",
        edgeType: "contradicts",
        confidence: 0.92,
        explanation: "These memories are linked by a contradiction edge from relationship extraction.",
        suggestion: "These memories may conflict. Consider asking the user to clarify which preference is current.",
      },
    ])
  })

  it("falls back to baseline retrieval when graph retrieval flag is disabled", async () => {
    const db = await setupDb("memories-queries-graph-off")
    await seedGraphRetrievalFixture(db)
    await seedContradictionEdgeFixture(db)
    const { getContextPayload } = await loadQueriesModule(false)

    const payload = await getContextPayload({
      turso: db,
      userId: null,
      nowIso: "2026-02-11T11:00:00.000Z",
      query: "",
      limit: 2,
      retrievalStrategy: "hybrid_graph",
      graphDepth: 1,
      graphLimit: 2,
    })

    expect(payload.data.memories.map((memory) => memory.id)).toEqual(["w1", "l-base"])
    expect(payload.data.trace.strategy).toBe("baseline")
    expect(payload.data.trace.requestedStrategy).toBe("hybrid_graph")
    expect(payload.data.trace.rolloutMode).toBe("off")
    expect(payload.data.trace.shadowExecuted).toBe(false)
    expect(payload.data.trace.qualityGateStatus).toBe("insufficient_data")
    expect(payload.data.trace.qualityGateBlocked).toBe(false)
    expect(payload.data.trace.qualityGateReasonCodes).toEqual([])
    expect(payload.data.trace.graphExpandedCount).toBe(0)
    expect(payload.data.trace.conflictCount).toBe(0)
    expect(payload.data.trace.fallbackTriggered).toBe(true)
    expect(payload.data.trace.fallbackReason).toBe("feature_flag_disabled")
    expect(payload.data.trace.totalCandidates).toBe(2)
    expect(payload.data.conflicts).toEqual([])
  })

  it("runs graph traversal in shadow mode without applying expansion", async () => {
    const db = await setupDb("memories-queries-graph-shadow")
    await seedGraphRetrievalFixture(db)
    const { getContextPayload } = await loadQueriesModule(true)
    const { setGraphRolloutConfig } = await import("./graph/rollout")

    await setGraphRolloutConfig(db, {
      mode: "shadow",
      nowIso: "2026-02-11T10:30:00.000Z",
      updatedBy: "test-user",
    })

    const payload = await getContextPayload({
      turso: db,
      userId: null,
      nowIso: "2026-02-11T11:00:00.000Z",
      query: "",
      limit: 2,
      retrievalStrategy: "hybrid_graph",
      graphDepth: 1,
      graphLimit: 2,
    })

    expect(payload.data.memories.map((memory) => memory.id)).toEqual(["w1", "l-base"])
    expect(payload.data.trace.strategy).toBe("baseline")
    expect(payload.data.trace.requestedStrategy).toBe("hybrid_graph")
    expect(payload.data.trace.rolloutMode).toBe("shadow")
    expect(payload.data.trace.shadowExecuted).toBe(true)
    expect(payload.data.trace.qualityGateStatus).toBe("insufficient_data")
    expect(payload.data.trace.qualityGateBlocked).toBe(false)
    expect(payload.data.trace.qualityGateReasonCodes).toEqual([])
    expect(payload.data.trace.graphCandidates).toBeGreaterThanOrEqual(1)
    expect(payload.data.trace.graphExpandedCount).toBe(0)
    expect(payload.data.trace.fallbackTriggered).toBe(true)
    expect(payload.data.trace.fallbackReason).toBe("shadow_mode")
  })

  it("blocks canary application when retrieval quality gate fails", async () => {
    const db = await setupDb("memories-queries-graph-canary-gate")
    await seedGraphRetrievalFixture(db)
    const { getContextPayload } = await loadQueriesModule(true)
    const { recordGraphRolloutMetric, setGraphRolloutConfig } = await import("./graph/rollout")

    await setGraphRolloutConfig(db, {
      mode: "canary",
      nowIso: "2026-02-11T10:30:00.000Z",
      updatedBy: "test-user",
    })

    for (let index = 0; index < 20; index += 1) {
      const fallbackTriggered = index < 4
      await recordGraphRolloutMetric(db, {
        nowIso: `2026-02-11T10:${index.toString().padStart(2, "0")}:00.000Z`,
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

    const payload = await getContextPayload({
      turso: db,
      userId: null,
      nowIso: "2026-02-11T11:00:00.000Z",
      query: "",
      limit: 2,
      retrievalStrategy: "hybrid_graph",
      graphDepth: 1,
      graphLimit: 2,
    })

    expect(payload.data.memories.map((memory) => memory.id)).toEqual(["w1", "l-base"])
    expect(payload.data.trace.strategy).toBe("baseline")
    expect(payload.data.trace.rolloutMode).toBe("canary")
    expect(payload.data.trace.shadowExecuted).toBe(true)
    expect(payload.data.trace.qualityGateStatus).toBe("fail")
    expect(payload.data.trace.qualityGateBlocked).toBe(true)
    expect(payload.data.trace.qualityGateReasonCodes).toContain("FALLBACK_RATE_ABOVE_LIMIT")
    expect(payload.data.trace.fallbackTriggered).toBe(true)
    expect(payload.data.trace.fallbackReason).toBe("quality_gate_blocked")
  })
})
