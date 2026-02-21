import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { expandMemoryGraph, graphReasonRank } from "./retrieval"
import { ensureGraphTables } from "./upsert"

type DbClient = ReturnType<typeof createClient>

const databases: DbClient[] = []

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "graph-retrieval.db")}` })
  databases.push(db)
  await ensureGraphTables(db)
  return db
}

afterEach(() => {
  for (const db of databases.splice(0, databases.length)) {
    db.close()
  }
})

describe("expandMemoryGraph", () => {
  it("traverses memory self-nodes without retrieval changes", async () => {
    const db = await setupDb("memories-graph-retrieval-memory-nodes")
    const nowIso = "2026-02-21T23:00:00.000Z"

    await db.batch([
      {
        sql: `INSERT INTO graph_nodes (id, node_type, node_key, label, metadata, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "graph-node:memory:mem-a",
          "memory",
          "mem-a",
          "seed memory",
          null,
          nowIso,
          nowIso,
          "graph-node:memory:mem-b",
          "memory",
          "mem-b",
          "linked memory",
          null,
          nowIso,
          nowIso,
        ],
      },
      {
        sql: `INSERT INTO memory_node_links (memory_id, node_id, role, created_at)
              VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
        args: [
          "mem-a",
          "graph-node:memory:mem-a",
          "self",
          nowIso,
          "mem-b",
          "graph-node:memory:mem-b",
          "self",
          nowIso,
        ],
      },
      {
        sql: `INSERT INTO graph_edges (
                id, from_node_id, to_node_id, edge_type, weight, confidence, evidence_memory_id, expires_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "edge:mem-a:mem-b",
          "graph-node:memory:mem-a",
          "graph-node:memory:mem-b",
          "similar_to",
          1,
          1,
          "mem-a",
          null,
          nowIso,
          nowIso,
        ],
      },
    ])

    const expanded = await expandMemoryGraph({
      turso: db,
      seedMemoryIds: ["mem-a"],
      nowIso,
      depth: 1,
      limit: 10,
    })

    expect(expanded.memoryIds).toEqual(["mem-b"])
    expect(expanded.reasons.get("mem-b")).toEqual(
      expect.objectContaining({
        whyIncluded: "graph_expansion",
        edgeType: "similar_to",
        hopCount: 1,
        confidence: 1,
        seedMemoryId: "mem-a",
        linkedViaNode: "memory:mem-b",
      })
    )
  })

  it("does not return the seed memory when only self-links exist", async () => {
    const db = await setupDb("memories-graph-retrieval-seed-self-only")
    const nowIso = "2026-02-21T23:10:00.000Z"

    await db.batch([
      {
        sql: `INSERT INTO graph_nodes (id, node_type, node_key, label, metadata, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: ["graph-node:memory:mem-seed", "memory", "mem-seed", "seed only", null, nowIso, nowIso],
      },
      {
        sql: `INSERT INTO memory_node_links (memory_id, node_id, role, created_at)
              VALUES (?, ?, ?, ?)`,
        args: ["mem-seed", "graph-node:memory:mem-seed", "self", nowIso],
      },
    ])

    const expanded = await expandMemoryGraph({
      turso: db,
      seedMemoryIds: ["mem-seed"],
      nowIso,
      depth: 2,
      limit: 10,
    })

    expect(expanded.memoryIds).toEqual([])
    expect(expanded.totalCandidates).toBe(0)
  })

  it("ranks causal edges above relational edges at equal hop count", () => {
    const causal = graphReasonRank({
      edgeType: "caused_by",
      hopCount: 1,
      confidence: 1,
    })
    const relational = graphReasonRank({
      edgeType: "similar_to",
      hopCount: 1,
      confidence: 1,
    })

    expect(causal).toBeGreaterThan(relational)
  })

  it("applies confidence weighting and hop decay to ranking", () => {
    const highConfidence = graphReasonRank({
      edgeType: "contradicts",
      hopCount: 1,
      confidence: 1,
    })
    const lowConfidence = graphReasonRank({
      edgeType: "contradicts",
      hopCount: 1,
      confidence: 0.5,
    })
    const decayed = graphReasonRank({
      edgeType: "contradicts",
      hopCount: 2,
      confidence: 1,
    })

    expect(lowConfidence).toBeCloseTo(highConfidence * 0.5)
    expect(decayed).toBeCloseTo(highConfidence / 2)
  })

  it("preserves shared_node boost behavior while ranking below direct relationship edges", () => {
    const sharedNode = graphReasonRank({
      edgeType: "shared_node",
      hopCount: 1,
      confidence: 1,
    })
    const similar = graphReasonRank({
      edgeType: "similar_to",
      hopCount: 1,
      confidence: 1,
    })

    expect(sharedNode).toBeGreaterThan(0)
    expect(sharedNode).toBeLessThan(similar)
  })
})
