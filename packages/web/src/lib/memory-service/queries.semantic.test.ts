import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

type DbClient = ReturnType<typeof createClient>

const testDatabases: DbClient[] = []
const originalGraphRetrievalEnabled = process.env.GRAPH_RETRIEVAL_ENABLED
const originalAiGatewayApiKey = process.env.AI_GATEWAY_API_KEY
const originalAiGatewayBaseUrl = process.env.AI_GATEWAY_BASE_URL
const originalDefaultEmbeddingModel = process.env.SDK_DEFAULT_EMBEDDING_MODEL_ID

function restoreEnv(): void {
  if (originalGraphRetrievalEnabled === undefined) {
    delete process.env.GRAPH_RETRIEVAL_ENABLED
  } else {
    process.env.GRAPH_RETRIEVAL_ENABLED = originalGraphRetrievalEnabled
  }
  if (originalAiGatewayApiKey === undefined) {
    delete process.env.AI_GATEWAY_API_KEY
  } else {
    process.env.AI_GATEWAY_API_KEY = originalAiGatewayApiKey
  }
  if (originalAiGatewayBaseUrl === undefined) {
    delete process.env.AI_GATEWAY_BASE_URL
  } else {
    process.env.AI_GATEWAY_BASE_URL = originalAiGatewayBaseUrl
  }
  if (originalDefaultEmbeddingModel === undefined) {
    delete process.env.SDK_DEFAULT_EMBEDDING_MODEL_ID
  } else {
    process.env.SDK_DEFAULT_EMBEDDING_MODEL_ID = originalDefaultEmbeddingModel
  }
}

async function loadQueriesModule() {
  vi.resetModules()
  process.env.GRAPH_RETRIEVAL_ENABLED = "false"
  return import("./queries")
}

function encodeEmbedding(values: number[]): Uint8Array {
  const vector = new Float32Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    vector[index] = values[index]
  }
  const copy = vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength)
  return new Uint8Array(copy)
}

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "queries-semantic.db")}` })
  testDatabases.push(db)

  await db.execute(
    `CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      memory_layer TEXT,
      expires_at TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
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
    `CREATE VIRTUAL TABLE memories_fts USING fts5(
      content,
      tags,
      content='memories',
      content_rowid='rowid'
    )`
  )
  await db.execute(`
    CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, tags)
      SELECT NEW.rowid, NEW.content, NEW.tags WHERE NEW.deleted_at IS NULL;
    END
  `)
  await db.execute(`
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', OLD.rowid, OLD.content, OLD.tags);
    END
  `)
  await db.execute(`
    CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', OLD.rowid, OLD.content, OLD.tags);
      INSERT INTO memories_fts(rowid, content, tags)
        SELECT NEW.rowid, NEW.content, NEW.tags WHERE NEW.deleted_at IS NULL;
    END
  `)

  await db.execute(
    `CREATE TABLE memory_embeddings (
      memory_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      model TEXT NOT NULL,
      model_version TEXT NOT NULL DEFAULT 'v1',
      dimension INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  )

  return db
}

async function seedRetrievalFixture(db: DbClient): Promise<void> {
  const now = "2026-02-20T00:00:00.000Z"
  await db.execute({
    sql: `INSERT INTO memories (
            id, content, type, memory_layer, expires_at, scope, project_id, user_id,
            tags, paths, category, metadata, deleted_at, created_at, updated_at
          ) VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "m-lex",
      "alpha keyword alpha keyword reference",
      "note",
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
      now,
      now,
      "m-sem",
      "related concept without lexical overlap",
      "note",
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
      now,
      now,
    ],
  })

  const model = "openai/text-embedding-3-small"
  await db.execute({
    sql: `INSERT INTO memory_embeddings (
            memory_id, embedding, model, model_version, dimension, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "m-lex",
      encodeEmbedding([0, 1]),
      model,
      model,
      2,
      now,
      now,
      "m-sem",
      encodeEmbedding([1, 0]),
      model,
      model,
      2,
      now,
      now,
    ],
  })
}

interface SeedScopedMemoryInput {
  id: string
  content: string
  layer: "working" | "long_term"
  scope: "global" | "project"
  projectId?: string | null
  userId?: string | null
  embedding: number[]
  createdAt: string
  updatedAt: string
}

async function insertScopedMemoryWithEmbedding(db: DbClient, input: SeedScopedMemoryInput): Promise<void> {
  const model = "openai/text-embedding-3-small"
  await db.execute({
    sql: `INSERT INTO memories (
            id, content, type, memory_layer, expires_at, scope, project_id, user_id,
            tags, paths, category, metadata, deleted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id,
      input.content,
      "note",
      input.layer,
      null,
      input.scope,
      input.projectId ?? null,
      input.userId ?? null,
      null,
      null,
      null,
      null,
      null,
      input.createdAt,
      input.updatedAt,
    ],
  })

  await db.execute({
    sql: `INSERT INTO memory_embeddings (
            memory_id, embedding, model, model_version, dimension, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id,
      encodeEmbedding(input.embedding),
      model,
      model,
      input.embedding.length,
      input.createdAt,
      input.updatedAt,
    ],
  })
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
  restoreEnv()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("semantic + hybrid retrieval", () => {
  it("prefers semantic neighbors for hybrid context retrieval and records trace metadata", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_key"
    process.env.AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"
    process.env.SDK_DEFAULT_EMBEDDING_MODEL_ID = "openai/text-embedding-3-small"

    const db = await setupDb("memories-hybrid-context")
    await seedRetrievalFixture(db)

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [1, 0] }],
            model: "openai/text-embedding-3-small",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    )

    const { getContextPayload } = await loadQueriesModule()
    const payload = await getContextPayload({
      turso: db,
      userId: null,
      nowIso: "2026-02-20T00:10:00.000Z",
      query: "alpha keyword",
      limit: 2,
      semanticStrategy: "hybrid",
      retrievalStrategy: "baseline",
      graphDepth: 0,
      graphLimit: 0,
    })

    expect(payload.data.memories.map((memory) => memory.id)).toEqual(["m-sem", "m-lex"])
    expect(payload.data.trace.semanticStrategyRequested).toBe("hybrid")
    expect(payload.data.trace.semanticStrategyApplied).toBe("hybrid")
    expect(payload.data.trace.semanticFallbackTriggered).toBe(false)
    expect(payload.data.trace.semanticCandidates).toBeGreaterThan(0)
  })

  it("falls back deterministically to lexical retrieval when query embeddings are unavailable", async () => {
    delete process.env.AI_GATEWAY_API_KEY
    process.env.AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"
    process.env.SDK_DEFAULT_EMBEDDING_MODEL_ID = "openai/text-embedding-3-small"

    const db = await setupDb("memories-semantic-fallback")
    await seedRetrievalFixture(db)
    const { getContextPayload } = await loadQueriesModule()

    const payload = await getContextPayload({
      turso: db,
      userId: null,
      nowIso: "2026-02-20T00:20:00.000Z",
      query: "alpha keyword",
      limit: 2,
      semanticStrategy: "semantic",
      retrievalStrategy: "baseline",
      graphDepth: 0,
      graphLimit: 0,
    })

    expect(payload.data.memories.map((memory) => memory.id)).toEqual(["m-lex"])
    expect(payload.data.trace.semanticStrategyRequested).toBe("semantic")
    expect(payload.data.trace.semanticStrategyApplied).toBe("lexical")
    expect(payload.data.trace.semanticFallbackTriggered).toBe(true)
    expect(payload.data.trace.semanticFallbackReason).toBe("query_embedding_unavailable")
  })

  it("returns hybrid search results with retrieval trace metadata", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_key"
    process.env.AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"
    process.env.SDK_DEFAULT_EMBEDDING_MODEL_ID = "openai/text-embedding-3-small"

    const db = await setupDb("memories-hybrid-search")
    await seedRetrievalFixture(db)

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [1, 0] }],
            model: "openai/text-embedding-3-small",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    )

    const { searchMemoriesPayload } = await loadQueriesModule()
    const payload = await searchMemoriesPayload({
      turso: db,
      args: {
        query: "alpha keyword",
        strategy: "hybrid",
        limit: 2,
      },
      userId: null,
      nowIso: "2026-02-20T00:30:00.000Z",
    })

    expect(payload.data.memories.map((memory) => memory.id)).toEqual(["m-sem", "m-lex"])
    expect(payload.data.trace.requestedStrategy).toBe("hybrid")
    expect(payload.data.trace.appliedStrategy).toBe("hybrid")
    expect(payload.data.trace.fallbackTriggered).toBe(false)
  })

  it("enforces project/user isolation on lexical and semantic retrieval paths", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_key"
    process.env.AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"
    process.env.SDK_DEFAULT_EMBEDDING_MODEL_ID = "openai/text-embedding-3-small"

    const db = await setupDb("memories-semantic-scope-isolation")
    const createdAt = "2026-02-20T01:00:00.000Z"

    await insertScopedMemoryWithEmbedding(db, {
      id: "allowed-global",
      content: "scope probe alpha global",
      layer: "long_term",
      scope: "global",
      projectId: null,
      userId: null,
      embedding: [1, 0],
      createdAt,
      updatedAt: "2026-02-20T01:00:01.000Z",
    })
    await insertScopedMemoryWithEmbedding(db, {
      id: "allowed-project",
      content: "scope probe alpha project",
      layer: "long_term",
      scope: "project",
      projectId: "project-a",
      userId: null,
      embedding: [1, 0],
      createdAt,
      updatedAt: "2026-02-20T01:00:02.000Z",
    })
    await insertScopedMemoryWithEmbedding(db, {
      id: "allowed-user",
      content: "scope probe alpha user",
      layer: "working",
      scope: "global",
      projectId: null,
      userId: "user-42",
      embedding: [1, 0],
      createdAt,
      updatedAt: "2026-02-20T01:00:03.000Z",
    })
    await insertScopedMemoryWithEmbedding(db, {
      id: "blocked-project",
      content: "scope probe alpha blocked project",
      layer: "long_term",
      scope: "project",
      projectId: "project-b",
      userId: null,
      embedding: [1, 0],
      createdAt,
      updatedAt: "2026-02-20T01:00:04.000Z",
    })
    await insertScopedMemoryWithEmbedding(db, {
      id: "blocked-user",
      content: "scope probe alpha blocked user",
      layer: "long_term",
      scope: "global",
      projectId: null,
      userId: "user-99",
      embedding: [1, 0],
      createdAt,
      updatedAt: "2026-02-20T01:00:05.000Z",
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [1, 0] }],
            model: "openai/text-embedding-3-small",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    )

    const { getContextPayload, searchMemoriesPayload } = await loadQueriesModule()
    const lexicalSearch = await searchMemoriesPayload({
      turso: db,
      args: {
        query: "scope probe alpha",
        strategy: "lexical",
        limit: 10,
      },
      projectId: "project-a",
      userId: "user-42",
      nowIso: "2026-02-20T01:10:00.000Z",
    })

    const semanticSearch = await searchMemoriesPayload({
      turso: db,
      args: {
        query: "scope probe alpha",
        strategy: "semantic",
        limit: 10,
      },
      projectId: "project-a",
      userId: "user-42",
      nowIso: "2026-02-20T01:10:00.000Z",
    })

    const lexicalIds = lexicalSearch.data.memories.map((memory) => memory.id)
    const semanticIds = semanticSearch.data.memories.map((memory) => memory.id)

    expect(lexicalIds).toEqual(expect.arrayContaining(["allowed-global", "allowed-project", "allowed-user"]))
    expect(semanticIds).toEqual(expect.arrayContaining(["allowed-global", "allowed-project", "allowed-user"]))
    expect(lexicalIds).not.toEqual(expect.arrayContaining(["blocked-project", "blocked-user"]))
    expect(semanticIds).not.toEqual(expect.arrayContaining(["blocked-project", "blocked-user"]))

    const contextPayload = await getContextPayload({
      turso: db,
      projectId: "project-a",
      userId: "user-42",
      nowIso: "2026-02-20T01:20:00.000Z",
      query: "scope probe alpha",
      limit: 10,
      semanticStrategy: "semantic",
      retrievalStrategy: "baseline",
      graphDepth: 0,
      graphLimit: 0,
    })

    const contextIds = contextPayload.data.memories.map((memory) => memory.id)
    expect(contextIds).toEqual(expect.arrayContaining(["allowed-global", "allowed-project", "allowed-user"]))
    expect(contextIds).not.toEqual(expect.arrayContaining(["blocked-project", "blocked-user"]))
    expect(contextPayload.data.trace.semanticStrategyApplied).toBe("semantic")
  })
})
