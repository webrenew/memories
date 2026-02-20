import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/scope-schema"
import { enqueueEmbeddingJob, processDueEmbeddingJobs } from "./jobs"

type DbClient = ReturnType<typeof createClient>

const testDatabases: DbClient[] = []

const originalAiGatewayApiKey = process.env.AI_GATEWAY_API_KEY
const originalAiGatewayBaseUrl = process.env.AI_GATEWAY_BASE_URL
const originalRetryBaseMs = process.env.SDK_EMBEDDING_JOB_RETRY_BASE_MS
const originalRetryMaxMs = process.env.SDK_EMBEDDING_JOB_RETRY_MAX_MS

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "embedding-jobs.db")}` })
  testDatabases.push(db)

  await db.execute(
    `CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      paths TEXT,
      category TEXT,
      metadata TEXT,
      tags TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`
  )

  await ensureMemoryUserIdSchema(db, { cacheKey: `jobs:${prefix}:${Date.now()}` })
  return db
}

async function insertMemory(
  db: DbClient,
  params: { id: string; content: string; nowIso?: string; deletedAt?: string | null }
): Promise<void> {
  const nowIso = params.nowIso ?? "2026-02-20T00:00:00.000Z"
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
      "global",
      null,
      null,
      null,
      null,
      null,
      null,
      params.deletedAt ?? null,
      nowIso,
      nowIso,
    ],
  })
}

function blobByteLength(value: unknown): number {
  if (value instanceof Uint8Array) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  return 0
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
  vi.unstubAllGlobals()
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
  if (originalRetryBaseMs === undefined) {
    delete process.env.SDK_EMBEDDING_JOB_RETRY_BASE_MS
  } else {
    process.env.SDK_EMBEDDING_JOB_RETRY_BASE_MS = originalRetryBaseMs
  }
  if (originalRetryMaxMs === undefined) {
    delete process.env.SDK_EMBEDDING_JOB_RETRY_MAX_MS
  } else {
    process.env.SDK_EMBEDDING_JOB_RETRY_MAX_MS = originalRetryMaxMs
  }
})

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "test_gateway_key"
  process.env.AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"
  process.env.SDK_EMBEDDING_JOB_RETRY_BASE_MS = "1000"
  process.env.SDK_EMBEDDING_JOB_RETRY_MAX_MS = "1000"
})

describe("sdk embedding jobs", () => {
  it("processes queued embedding jobs and upserts memory embeddings", async () => {
    const db = await setupDb("memories-embedding-jobs-success")
    await insertMemory(db, { id: "mem_success", content: "The queue should persist this memory." })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.12, -0.33, 0.48] }],
            model: "openai/text-embedding-3-small",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    )

    await enqueueEmbeddingJob({
      turso: db,
      memoryId: "mem_success",
      content: "The queue should persist this memory.",
      modelId: "openai/text-embedding-3-small",
      operation: "add",
      nowIso: "2026-02-20T00:00:00.000Z",
    })

    const summary = await processDueEmbeddingJobs({
      turso: db,
      maxJobs: 1,
      nowIso: "2026-02-20T00:00:00.000Z",
    })

    expect(summary).toEqual({
      processed: 1,
      success: 1,
      retries: 0,
      deadLetters: 0,
      skipped: 0,
    })

    const embeddingResult = await db.execute({
      sql: "SELECT memory_id, model, model_version, dimension, embedding FROM memory_embeddings WHERE memory_id = ?",
      args: ["mem_success"],
    })
    expect(embeddingResult.rows).toHaveLength(1)
    const embeddingRow = embeddingResult.rows[0] as Record<string, unknown>
    expect(String(embeddingRow.memory_id)).toBe("mem_success")
    expect(String(embeddingRow.model)).toBe("openai/text-embedding-3-small")
    expect(String(embeddingRow.model_version)).toBe("openai/text-embedding-3-small")
    expect(Number(embeddingRow.dimension)).toBe(3)
    expect(blobByteLength(embeddingRow.embedding)).toBe(12)

    const jobResult = await db.execute({
      sql: "SELECT status, attempt_count FROM memory_embedding_jobs WHERE memory_id = ?",
      args: ["mem_success"],
    })
    expect(String(jobResult.rows[0]?.status ?? "")).toBe("succeeded")
    expect(Number(jobResult.rows[0]?.attempt_count ?? -1)).toBe(1)

    const metricsResult = await db.execute({
      sql: "SELECT outcome FROM memory_embedding_job_metrics WHERE memory_id = ?",
      args: ["mem_success"],
    })
    expect(metricsResult.rows).toHaveLength(1)
    expect(String(metricsResult.rows[0]?.outcome ?? "")).toBe("success")
  })

  it("retries retryable failures and dead-letters after max attempts", async () => {
    const db = await setupDb("memories-embedding-jobs-retry")
    await insertMemory(db, { id: "mem_retry", content: "Retry this embedding job until dead-letter." })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("gateway unavailable", {
          status: 503,
          headers: { "content-type": "text/plain" },
        })
      )
    )

    await enqueueEmbeddingJob({
      turso: db,
      memoryId: "mem_retry",
      content: "Retry this embedding job until dead-letter.",
      modelId: "openai/text-embedding-3-small",
      operation: "edit",
      maxAttempts: 2,
      nowIso: "2026-02-20T01:00:00.000Z",
    })

    const firstRun = await processDueEmbeddingJobs({
      turso: db,
      maxJobs: 1,
      nowIso: "2026-02-20T01:00:00.000Z",
    })
    expect(firstRun.processed).toBe(1)
    expect(firstRun.retries).toBe(1)

    const afterFirstFailure = await db.execute({
      sql: "SELECT status, attempt_count FROM memory_embedding_jobs WHERE memory_id = ?",
      args: ["mem_retry"],
    })
    expect(String(afterFirstFailure.rows[0]?.status ?? "")).toBe("queued")
    expect(Number(afterFirstFailure.rows[0]?.attempt_count ?? -1)).toBe(1)

    await db.execute({
      sql: "UPDATE memory_embedding_jobs SET next_attempt_at = ? WHERE memory_id = ?",
      args: ["2026-02-20T00:59:00.000Z", "mem_retry"],
    })

    const secondRun = await processDueEmbeddingJobs({
      turso: db,
      maxJobs: 1,
      nowIso: "2026-02-20T01:01:00.000Z",
    })
    expect(secondRun.processed).toBe(1)
    expect(secondRun.deadLetters).toBe(1)

    const deadLetterJob = await db.execute({
      sql: "SELECT status, attempt_count, dead_letter_at FROM memory_embedding_jobs WHERE memory_id = ?",
      args: ["mem_retry"],
    })
    expect(String(deadLetterJob.rows[0]?.status ?? "")).toBe("dead_letter")
    expect(Number(deadLetterJob.rows[0]?.attempt_count ?? -1)).toBe(2)
    expect(String(deadLetterJob.rows[0]?.dead_letter_at ?? "")).toContain("2026-02-20")

    const metrics = await db.execute({
      sql: "SELECT outcome FROM memory_embedding_job_metrics WHERE memory_id = ? ORDER BY created_at ASC",
      args: ["mem_retry"],
    })
    expect(metrics.rows.map((row) => String(row.outcome))).toEqual(["retry", "dead_letter"])
  })
})
