import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { computeSimilarityEdges, syncRelationshipEdgesForMemory, syncSimilarityEdgesForMemory } from "./similarity"
import { expandMemoryGraph } from "./retrieval"
import { ensureGraphTables, removeMemoryGraphMapping, syncMemoryGraphMapping } from "./upsert"

type DbClient = ReturnType<typeof createClient>

const databases: DbClient[] = []

function encodeEmbedding(values: number[]): Uint8Array {
  const vector = new Float32Array(values)
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength))
}

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "graph-similarity.db")}` })
  databases.push(db)

  await db.execute(
    `CREATE TABLE memories (
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

  await db.execute(
    `CREATE TABLE memory_embeddings (
      memory_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      model TEXT NOT NULL,
      model_version TEXT,
      dimension INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  )

  await ensureGraphTables(db)
  return db
}

async function insertMemory(db: DbClient, params: {
  id: string
  content: string
  nowIso: string
  projectId?: string | null
  userId?: string | null
}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO memories (
            id, content, type, memory_layer, expires_at, scope, project_id, user_id,
            tags, paths, category, metadata, deleted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      params.id,
      params.content,
      "note",
      "long_term",
      null,
      params.projectId ? "project" : "global",
      params.projectId ?? null,
      params.userId ?? null,
      null,
      null,
      null,
      null,
      null,
      params.nowIso,
      params.nowIso,
    ],
  })

  await syncMemoryGraphMapping(db, {
    id: params.id,
    content: params.content,
    type: "note",
    layer: "long_term",
    expiresAt: null,
    projectId: params.projectId ?? null,
    userId: params.userId ?? null,
    tags: [],
    category: null,
  })
}

async function upsertEmbedding(db: DbClient, params: {
  memoryId: string
  model: string
  embedding: number[]
  nowIso: string
}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO memory_embeddings (
            memory_id, embedding, model, model_version, dimension, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(memory_id) DO UPDATE SET
            embedding = excluded.embedding,
            model = excluded.model,
            model_version = excluded.model_version,
            dimension = excluded.dimension,
            updated_at = excluded.updated_at`,
    args: [
      params.memoryId,
      encodeEmbedding(params.embedding),
      params.model,
      params.model,
      params.embedding.length,
      params.nowIso,
      params.nowIso,
    ],
  })
}

afterEach(() => {
  for (const db of databases.splice(0, databases.length)) {
    db.close()
  }
})

describe("similarity graph edges", () => {
  it("creates bidirectional similar_to edges above threshold", async () => {
    const db = await setupDb("memories-graph-similarity-bidirectional")
    const nowIso = "2026-02-22T00:00:00.000Z"
    const modelId = "openai/text-embedding-3-small"

    await insertMemory(db, {
      id: "mem-a",
      content: "A memory about auth",
      nowIso,
      projectId: "github.com/webrenew/memories",
      userId: "user-1",
    })
    await insertMemory(db, {
      id: "mem-b",
      content: "A related auth memory",
      nowIso,
      projectId: "github.com/webrenew/memories",
      userId: "user-1",
    })

    await upsertEmbedding(db, {
      memoryId: "mem-b",
      model: modelId,
      embedding: [0.99, 0.01],
      nowIso,
    })

    await syncSimilarityEdgesForMemory({
      turso: db,
      memoryId: "mem-a",
      embedding: [1, 0],
      modelId,
      projectId: "github.com/webrenew/memories",
      userId: "user-1",
      layer: "long_term",
      expiresAt: null,
      nowIso,
      threshold: 0.85,
    })

    const result = await db.execute({
      sql: `SELECT from_n.node_key AS from_key, to_n.node_key AS to_key, e.edge_type
            FROM graph_edges e
            JOIN graph_nodes from_n ON from_n.id = e.from_node_id
            JOIN graph_nodes to_n ON to_n.id = e.to_node_id
            WHERE e.edge_type = 'similar_to'
            ORDER BY from_key, to_key`,
    })

    const pairs = result.rows.map((row) => `${row.from_key}->${row.to_key}`)
    expect(pairs).toEqual(["mem-a->mem-b", "mem-b->mem-a"])

    const expansion = await expandMemoryGraph({
      turso: db,
      seedMemoryIds: ["mem-a"],
      nowIso,
      depth: 1,
      limit: 5,
    })
    expect(expansion.memoryIds).toEqual(["mem-b"])

    await removeMemoryGraphMapping(db, "mem-a")
    const remainingSimilarEdges = await db.execute({
      sql: `SELECT COUNT(*) AS count
            FROM graph_edges e
            JOIN graph_nodes n ON n.id = e.from_node_id OR n.id = e.to_node_id
            WHERE e.edge_type = 'similar_to' AND n.node_type = 'memory' AND n.node_key = ?`,
      args: ["mem-a"],
    })
    expect(Number(remainingSimilarEdges.rows[0]?.count ?? 0)).toBe(0)
  })

  it("filters candidates below threshold", async () => {
    const db = await setupDb("memories-graph-similarity-threshold")
    const nowIso = "2026-02-22T00:05:00.000Z"
    const modelId = "openai/text-embedding-3-small"

    await insertMemory(db, { id: "mem-a", content: "Seed", nowIso })
    await insertMemory(db, { id: "mem-b", content: "Candidate", nowIso })
    await upsertEmbedding(db, {
      memoryId: "mem-b",
      model: modelId,
      embedding: [0, 1],
      nowIso,
    })

    const edges = await computeSimilarityEdges({
      turso: db,
      memoryId: "mem-a",
      embedding: [1, 0],
      modelId,
      projectId: null,
      userId: null,
      layer: "long_term",
      expiresAt: null,
      nowIso,
      threshold: 0.95,
    })

    expect(edges).toEqual([])
  })

  it("recomputes and prunes stale similar_to edges on edit", async () => {
    const db = await setupDb("memories-graph-similarity-recompute")
    const nowIso = "2026-02-22T00:10:00.000Z"
    const modelId = "openai/text-embedding-3-small"

    await insertMemory(db, { id: "mem-a", content: "Seed", nowIso })
    await insertMemory(db, { id: "mem-b", content: "Candidate B", nowIso })
    await insertMemory(db, { id: "mem-c", content: "Candidate C", nowIso })

    await upsertEmbedding(db, { memoryId: "mem-b", model: modelId, embedding: [1, 0], nowIso })
    await upsertEmbedding(db, { memoryId: "mem-c", model: modelId, embedding: [0, 1], nowIso })

    await syncSimilarityEdgesForMemory({
      turso: db,
      memoryId: "mem-a",
      embedding: [0.99, 0.01],
      modelId,
      projectId: null,
      userId: null,
      layer: "long_term",
      expiresAt: null,
      nowIso,
      threshold: 0.8,
      maxEdges: 1,
    })

    await syncSimilarityEdgesForMemory({
      turso: db,
      memoryId: "mem-a",
      embedding: [0.01, 0.99],
      modelId,
      projectId: null,
      userId: null,
      layer: "long_term",
      expiresAt: null,
      nowIso,
      threshold: 0.8,
      maxEdges: 1,
    })

    const result = await db.execute({
      sql: `SELECT from_n.node_key AS from_key, to_n.node_key AS to_key
            FROM graph_edges e
            JOIN graph_nodes from_n ON from_n.id = e.from_node_id
            JOIN graph_nodes to_n ON to_n.id = e.to_node_id
            WHERE e.edge_type = 'similar_to'
              AND (from_n.node_key = 'mem-a' OR to_n.node_key = 'mem-a')
            ORDER BY from_key, to_key`,
    })

    const pairs = result.rows.map((row) => `${row.from_key}->${row.to_key}`)
    expect(pairs).toEqual(["mem-a->mem-c", "mem-c->mem-a"])
  })

  it("adds contradicts edges for ambiguous candidates when classifier signals conflict", async () => {
    const db = await setupDb("memories-graph-similarity-contradicts")
    const nowIso = "2026-02-22T00:15:00.000Z"
    const modelId = "openai/text-embedding-3-small"

    await insertMemory(db, { id: "mem-a", content: "I like coffee", nowIso })
    await insertMemory(db, { id: "mem-b", content: "I dislike coffee", nowIso })
    await upsertEmbedding(db, {
      memoryId: "mem-b",
      model: modelId,
      embedding: [0.8, 0.6],
      nowIso,
    })

    await syncRelationshipEdgesForMemory({
      turso: db,
      memoryId: "mem-a",
      embedding: [1, 0],
      modelId,
      projectId: null,
      userId: null,
      layer: "long_term",
      expiresAt: null,
      nowIso,
      threshold: 0.95,
      ambiguousMinScore: 0.7,
      ambiguousMaxScore: 0.9,
      llmConfidenceThreshold: 0.7,
      memoryContent: "I like coffee",
      memoryCreatedAt: nowIso,
      classifier: async () => ({
        relationship: "contradicts",
        confidence: 0.92,
        explanation: "Opposite preference for same topic.",
      }),
    })

    const result = await db.execute({
      sql: `SELECT from_n.node_key AS from_key, to_n.node_key AS to_key, e.edge_type
            FROM graph_edges e
            JOIN graph_nodes from_n ON from_n.id = e.from_node_id
            JOIN graph_nodes to_n ON to_n.id = e.to_node_id
            WHERE e.edge_type = 'contradicts'
            ORDER BY from_key, to_key`,
    })

    const pairs = result.rows.map((row) => `${row.from_key}->${row.to_key}`)
    expect(pairs).toEqual(["mem-a->mem-b", "mem-b->mem-a"])
  })

  it("adds supersedes edge from newer memory when classifier returns refines", async () => {
    const db = await setupDb("memories-graph-similarity-supersedes")
    const modelId = "openai/text-embedding-3-small"
    const olderIso = "2026-02-22T00:00:00.000Z"
    const newerIso = "2026-02-22T00:20:00.000Z"

    await insertMemory(db, { id: "mem-old", content: "I drink coffee", nowIso: olderIso })
    await insertMemory(db, { id: "mem-new", content: "I only drink decaf", nowIso: newerIso })
    await upsertEmbedding(db, {
      memoryId: "mem-old",
      model: modelId,
      embedding: [0.8, 0.6],
      nowIso: newerIso,
    })

    await syncRelationshipEdgesForMemory({
      turso: db,
      memoryId: "mem-new",
      embedding: [1, 0],
      modelId,
      projectId: null,
      userId: null,
      layer: "long_term",
      expiresAt: null,
      nowIso: newerIso,
      threshold: 0.95,
      ambiguousMinScore: 0.7,
      ambiguousMaxScore: 0.9,
      llmConfidenceThreshold: 0.7,
      memoryContent: "I only drink decaf",
      memoryCreatedAt: newerIso,
      classifier: async () => ({
        relationship: "refines",
        confidence: 0.88,
        explanation: "The new memory narrows the original statement.",
      }),
    })

    const result = await db.execute({
      sql: `SELECT from_n.node_key AS from_key, to_n.node_key AS to_key
            FROM graph_edges e
            JOIN graph_nodes from_n ON from_n.id = e.from_node_id
            JOIN graph_nodes to_n ON to_n.id = e.to_node_id
            WHERE e.edge_type = 'supersedes'
            ORDER BY from_key, to_key`,
    })

    const pairs = result.rows.map((row) => `${row.from_key}->${row.to_key}`)
    expect(pairs).toEqual(["mem-new->mem-old"])
  })

  it("skips llm relationship edges below confidence threshold", async () => {
    const db = await setupDb("memories-graph-similarity-confidence-threshold")
    const nowIso = "2026-02-22T00:25:00.000Z"
    const modelId = "openai/text-embedding-3-small"

    await insertMemory(db, { id: "mem-a", content: "I like tea", nowIso })
    await insertMemory(db, { id: "mem-b", content: "I dislike tea", nowIso })
    await upsertEmbedding(db, {
      memoryId: "mem-b",
      model: modelId,
      embedding: [0.8, 0.6],
      nowIso,
    })

    await syncRelationshipEdgesForMemory({
      turso: db,
      memoryId: "mem-a",
      embedding: [1, 0],
      modelId,
      projectId: null,
      userId: null,
      layer: "long_term",
      expiresAt: null,
      nowIso,
      threshold: 0.95,
      ambiguousMinScore: 0.7,
      ambiguousMaxScore: 0.9,
      llmConfidenceThreshold: 0.8,
      memoryContent: "I like tea",
      memoryCreatedAt: nowIso,
      classifier: async () => ({
        relationship: "contradicts",
        confidence: 0.5,
        explanation: "Low confidence conflict.",
      }),
    })

    const result = await db.execute({
      sql: `SELECT COUNT(*) AS count
            FROM graph_edges
            WHERE edge_type IN ('contradicts', 'supersedes')`,
    })

    expect(Number(result.rows[0]?.count ?? 0)).toBe(0)
  })

  it("adds semantic relationship edge types and reuses condition nodes", async () => {
    const db = await setupDb("memories-graph-semantic-relationships")
    const nowIso = "2026-02-22T00:30:00.000Z"
    const modelId = "openai/text-embedding-3-small"

    await insertMemory(db, {
      id: "mem-new",
      content: "I stopped fast food because I'm on a diet and now only drink coffee in the morning.",
      nowIso,
    })
    await insertMemory(db, {
      id: "mem-target",
      content: "I'm on a diet and planning meals.",
      nowIso,
    })

    const semanticExtractor = async () => ({
      edges: [
        {
          type: "caused_by" as const,
          targetMemoryId: "mem-target",
          direction: "from_new" as const,
          confidence: 0.9,
          evidence: "because I'm on a diet",
        },
        {
          type: "prefers_over" as const,
          targetMemoryId: "mem-target",
          direction: "from_new" as const,
          confidence: 0.82,
          evidence: "prefer this over that",
        },
        {
          type: "depends_on" as const,
          targetMemoryId: "mem-target",
          direction: "to_new" as const,
          confidence: 0.78,
          evidence: "do this before that",
        },
        {
          type: "specializes" as const,
          targetMemoryId: "mem-target",
          direction: "from_new" as const,
          confidence: 0.76,
          evidence: "specific type",
        },
        {
          type: "conditional_on" as const,
          conditionKey: "time:morning",
          direction: "from_new" as const,
          confidence: 0.88,
          evidence: "in the morning",
        },
      ],
    })

    await syncRelationshipEdgesForMemory({
      turso: db,
      memoryId: "mem-new",
      embedding: [1, 0],
      modelId,
      projectId: null,
      userId: null,
      layer: "long_term",
      expiresAt: null,
      nowIso,
      threshold: 0.99,
      memoryContent: "I stopped fast food because I'm on a diet and now only drink coffee in the morning.",
      memoryCreatedAt: nowIso,
      semanticExtractor,
    })

    await syncRelationshipEdgesForMemory({
      turso: db,
      memoryId: "mem-new",
      embedding: [1, 0],
      modelId,
      projectId: null,
      userId: null,
      layer: "long_term",
      expiresAt: null,
      nowIso,
      threshold: 0.99,
      memoryContent: "I stopped fast food because I'm on a diet and now only drink coffee in the morning.",
      memoryCreatedAt: nowIso,
      semanticExtractor,
    })

    const edgeCounts = await db.execute({
      sql: `SELECT edge_type, COUNT(*) AS count
            FROM graph_edges
            WHERE edge_type IN ('caused_by', 'prefers_over', 'depends_on', 'specializes', 'conditional_on')
            GROUP BY edge_type`,
    })
    const counts = new Map(edgeCounts.rows.map((row) => [String(row.edge_type), Number(row.count)]))

    expect(counts.get("caused_by")).toBe(1)
    expect(counts.get("prefers_over")).toBe(1)
    expect(counts.get("depends_on")).toBe(1)
    expect(counts.get("specializes")).toBe(1)
    expect(counts.get("conditional_on")).toBe(1)

    const conditionNodes = await db.execute({
      sql: `SELECT COUNT(*) AS count
            FROM graph_nodes
            WHERE node_type = 'condition' AND node_key = ?`,
      args: ["time:morning"],
    })

    expect(Number(conditionNodes.rows[0]?.count ?? 0)).toBe(1)
  })
})
