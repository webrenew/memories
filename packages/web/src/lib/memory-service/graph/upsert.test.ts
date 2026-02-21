import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { removeMemoryGraphMapping, syncMemoryGraphMapping } from "./upsert"

type DbClient = ReturnType<typeof createClient>

let db: DbClient

async function scalarCount(turso: DbClient, sql: string, args: (string | number | null)[] = []): Promise<number> {
  const result = await turso.execute({ sql, args })
  return Number(result.rows[0]?.count ?? 0)
}

describe("syncMemoryGraphMapping", () => {
  beforeAll(() => {
    const dbDir = mkdtempSync(join(tmpdir(), "memories-graph-upsert-test-"))
    db = createClient({ url: `file:${join(dbDir, "graph.db")}` })
  })

  afterAll(() => {
    db.close()
  })

  it("is idempotent for repeated sync of the same memory", async () => {
    const input = {
      id: "mem-graph-1",
      content: "Graph mapping should stay deterministic across repeated sync operations.",
      type: "decision",
      layer: "long_term" as const,
      expiresAt: null,
      projectId: "github.com/webrenew/memories",
      userId: "user-a",
      tags: ["auth", "mcp"],
      category: "architecture",
    }

    await syncMemoryGraphMapping(db, input)

    const first = {
      nodes: await scalarCount(db, "SELECT COUNT(*) as count FROM graph_nodes"),
      edges: await scalarCount(db, "SELECT COUNT(*) as count FROM graph_edges"),
      links: await scalarCount(db, "SELECT COUNT(*) as count FROM memory_node_links"),
    }

    await syncMemoryGraphMapping(db, input)

    const second = {
      nodes: await scalarCount(db, "SELECT COUNT(*) as count FROM graph_nodes"),
      edges: await scalarCount(db, "SELECT COUNT(*) as count FROM graph_edges"),
      links: await scalarCount(db, "SELECT COUNT(*) as count FROM memory_node_links"),
    }

    expect(second).toEqual(first)
    expect(first.nodes).toBeGreaterThan(0)
    expect(first.edges).toBeGreaterThan(0)
    expect(first.links).toBeGreaterThan(0)
  })

  it("replaces stale edges/links on edit and removes mappings on forget", async () => {
    await syncMemoryGraphMapping(db, {
      id: "mem-graph-2",
      content: "Track billing and limits incidents.",
      type: "fact",
      layer: "working",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      projectId: "github.com/webrenew/memories",
      userId: "user-b",
      tags: ["billing", "limits"],
      category: "ops",
    })

    const billingLinkCount = await scalarCount(
      db,
      `SELECT COUNT(*) as count
       FROM memory_node_links l
       JOIN graph_nodes n ON n.id = l.node_id
       WHERE l.memory_id = ? AND n.node_type = 'topic' AND n.node_key = 'billing'`,
      ["mem-graph-2"]
    )
    expect(billingLinkCount).toBe(1)

    await syncMemoryGraphMapping(db, {
      id: "mem-graph-2",
      content: "Track migration work after billing incidents.",
      type: "fact",
      layer: "long_term",
      expiresAt: null,
      projectId: "github.com/webrenew/memories",
      userId: "user-b",
      tags: ["migrations"],
      category: "ops",
    })

    const staleBillingLinkCount = await scalarCount(
      db,
      `SELECT COUNT(*) as count
       FROM memory_node_links l
       JOIN graph_nodes n ON n.id = l.node_id
       WHERE l.memory_id = ? AND n.node_type = 'topic' AND n.node_key = 'billing'`,
      ["mem-graph-2"]
    )
    const migrationsLinkCount = await scalarCount(
      db,
      `SELECT COUNT(*) as count
       FROM memory_node_links l
       JOIN graph_nodes n ON n.id = l.node_id
       WHERE l.memory_id = ? AND n.node_type = 'topic' AND n.node_key = 'migrations'`,
      ["mem-graph-2"]
    )
    expect(staleBillingLinkCount).toBe(0)
    expect(migrationsLinkCount).toBe(1)

    const memoryNodeCountBeforeForget = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM graph_nodes WHERE node_type = 'memory' AND node_key = ?",
      ["mem-graph-2"]
    )
    expect(memoryNodeCountBeforeForget).toBe(1)

    await removeMemoryGraphMapping(db, "mem-graph-2")

    const remainingLinks = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM memory_node_links WHERE memory_id = ?",
      ["mem-graph-2"]
    )
    const remainingEdges = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM graph_edges WHERE evidence_memory_id = ?",
      ["mem-graph-2"]
    )
    const memoryNodeCountAfterForget = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM graph_nodes WHERE node_type = 'memory' AND node_key = ?",
      ["mem-graph-2"]
    )

    expect(remainingLinks).toBe(0)
    expect(remainingEdges).toBe(0)
    expect(memoryNodeCountAfterForget).toBe(0)
  })

  it("updates edge expiry when a memory transitions from working to long_term", async () => {
    const memoryId = "mem-graph-ttl"
    const expiresAt = new Date(Date.now() + 120_000).toISOString()

    await syncMemoryGraphMapping(db, {
      id: memoryId,
      type: "note",
      layer: "working",
      expiresAt,
      projectId: "github.com/webrenew/memories",
      userId: "user-ttl",
      tags: ["incident"],
      category: "ops",
    })

    const workingEdgeCounts = await db.execute({
      sql: `SELECT
              COUNT(*) as total,
              SUM(CASE WHEN expires_at IS NOT NULL THEN 1 ELSE 0 END) as with_expiry
            FROM graph_edges
            WHERE evidence_memory_id = ?`,
      args: [memoryId],
    })
    const workingTotal = Number(workingEdgeCounts.rows[0]?.total ?? 0)
    const workingWithExpiry = Number(workingEdgeCounts.rows[0]?.with_expiry ?? 0)

    expect(workingTotal).toBeGreaterThan(0)
    expect(workingWithExpiry).toBe(workingTotal)

    await syncMemoryGraphMapping(db, {
      id: memoryId,
      type: "note",
      layer: "long_term",
      expiresAt: null,
      projectId: "github.com/webrenew/memories",
      userId: "user-ttl",
      tags: ["incident"],
      category: "ops",
    })

    const longTermEdgeCounts = await db.execute({
      sql: `SELECT
              COUNT(*) as total,
              SUM(CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END) as without_expiry
            FROM graph_edges
            WHERE evidence_memory_id = ?`,
      args: [memoryId],
    })
    const longTermTotal = Number(longTermEdgeCounts.rows[0]?.total ?? 0)
    const longTermWithoutExpiry = Number(longTermEdgeCounts.rows[0]?.without_expiry ?? 0)

    expect(longTermTotal).toBeGreaterThan(0)
    expect(longTermWithoutExpiry).toBe(longTermTotal)
  })

  it("keeps shared nodes when one of multiple linked memories is removed", async () => {
    const sharedTag = "shared-tag"

    await syncMemoryGraphMapping(db, {
      id: "mem-shared-a",
      type: "note",
      layer: "long_term",
      expiresAt: null,
      projectId: "github.com/webrenew/memories",
      userId: "user-shared",
      tags: [sharedTag],
      category: "ops",
    })

    await syncMemoryGraphMapping(db, {
      id: "mem-shared-b",
      type: "note",
      layer: "long_term",
      expiresAt: null,
      projectId: "github.com/webrenew/memories",
      userId: "user-shared",
      tags: [sharedTag],
      category: "ops",
    })

    const topicNodeBefore = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM graph_nodes WHERE node_type = 'topic' AND node_key = ?",
      [sharedTag]
    )
    expect(topicNodeBefore).toBe(1)

    await removeMemoryGraphMapping(db, "mem-shared-a")

    const topicNodeAfter = await scalarCount(
      db,
      "SELECT COUNT(*) as count FROM graph_nodes WHERE node_type = 'topic' AND node_key = ?",
      [sharedTag]
    )
    const remainingLinks = await scalarCount(
      db,
      `SELECT COUNT(*) as count
       FROM memory_node_links l
       JOIN graph_nodes n ON n.id = l.node_id
       WHERE l.memory_id = 'mem-shared-b' AND n.node_type = 'topic' AND n.node_key = ?`,
      [sharedTag]
    )

    expect(topicNodeAfter).toBe(1)
    expect(remainingLinks).toBe(1)
  })
})
