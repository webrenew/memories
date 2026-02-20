import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/scope-schema"
import { getEmbeddingBackfillStatus, runEmbeddingBackfillBatch, setEmbeddingBackfillPaused } from "./backfill"

type DbClient = ReturnType<typeof createClient>

const testDatabases: DbClient[] = []

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "embedding-backfill.db")}` })
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

  await ensureMemoryUserIdSchema(db, { cacheKey: `backfill:${prefix}:${Date.now()}` })
  return db
}

async function insertMemory(db: DbClient, params: { id: string; content: string; createdAt: string }): Promise<void> {
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
      null,
      params.createdAt,
      params.createdAt,
    ],
  })
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
})

describe("sdk embedding backfill", () => {
  it("tracks checkpointed progress across batches and completes idempotently", async () => {
    const db = await setupDb("memories-embedding-backfill-progress")
    await insertMemory(db, { id: "mem-1", content: "First memory", createdAt: "2026-02-20T00:00:00.000Z" })
    await insertMemory(db, { id: "mem-2", content: "Second memory", createdAt: "2026-02-20T00:00:01.000Z" })
    await insertMemory(db, { id: "mem-3", content: "Third memory", createdAt: "2026-02-20T00:00:02.000Z" })
    await insertMemory(db, { id: "mem-4", content: "Fourth memory", createdAt: "2026-02-20T00:00:03.000Z" })

    const firstBatch = await runEmbeddingBackfillBatch({
      turso: db,
      modelId: "openai/text-embedding-3-small",
      batchLimit: 2,
      throttleMs: 0,
      nowIso: "2026-02-20T00:10:00.000Z",
    })

    expect(firstBatch.batch.scanned).toBe(2)
    expect(firstBatch.batch.enqueued).toBe(2)
    expect(firstBatch.status.status).toBe("running")
    expect(firstBatch.status.checkpointMemoryId).toBe("mem-2")
    expect(firstBatch.status.estimatedRemaining).toBe(2)

    const queueAfterFirst = await db.execute("SELECT COUNT(*) as count FROM memory_embedding_jobs")
    expect(Number(queueAfterFirst.rows[0]?.count ?? 0)).toBe(2)

    const secondBatch = await runEmbeddingBackfillBatch({
      turso: db,
      modelId: "openai/text-embedding-3-small",
      batchLimit: 2,
      throttleMs: 0,
      nowIso: "2026-02-20T00:11:00.000Z",
    })

    expect(secondBatch.batch.scanned).toBe(2)
    expect(secondBatch.batch.enqueued).toBe(2)
    expect(secondBatch.status.status).toBe("completed")
    expect(secondBatch.status.estimatedRemaining).toBe(0)
    expect(secondBatch.status.estimatedCompletionSeconds).toBe(0)

    const queueAfterSecond = await db.execute("SELECT COUNT(*) as count FROM memory_embedding_jobs")
    expect(Number(queueAfterSecond.rows[0]?.count ?? 0)).toBe(4)

    const thirdBatch = await runEmbeddingBackfillBatch({
      turso: db,
      modelId: "openai/text-embedding-3-small",
      batchLimit: 2,
      throttleMs: 0,
      nowIso: "2026-02-20T00:12:00.000Z",
    })
    expect(thirdBatch.batch.scanned).toBe(0)
    expect(thirdBatch.batch.enqueued).toBe(0)
    expect(thirdBatch.status.status).toBe("completed")

    const queueAfterThird = await db.execute("SELECT COUNT(*) as count FROM memory_embedding_jobs")
    expect(Number(queueAfterThird.rows[0]?.count ?? 0)).toBe(4)
  })

  it("supports pausing and resuming backfill runs", async () => {
    const db = await setupDb("memories-embedding-backfill-pause")
    await insertMemory(db, { id: "mem-a", content: "Only memory", createdAt: "2026-02-20T01:00:00.000Z" })

    const paused = await setEmbeddingBackfillPaused({
      turso: db,
      modelId: "openai/text-embedding-3-small",
      paused: true,
      nowIso: "2026-02-20T01:05:00.000Z",
    })
    expect(paused.status).toBe("paused")

    const pausedRun = await runEmbeddingBackfillBatch({
      turso: db,
      modelId: "openai/text-embedding-3-small",
      batchLimit: 10,
      throttleMs: 0,
      nowIso: "2026-02-20T01:06:00.000Z",
    })
    expect(pausedRun.batch.scanned).toBe(0)
    expect(pausedRun.batch.enqueued).toBe(0)
    expect(pausedRun.status.status).toBe("paused")

    const resumed = await setEmbeddingBackfillPaused({
      turso: db,
      modelId: "openai/text-embedding-3-small",
      paused: false,
      nowIso: "2026-02-20T01:07:00.000Z",
    })
    expect(resumed.status).toBe("idle")

    const resumedRun = await runEmbeddingBackfillBatch({
      turso: db,
      modelId: "openai/text-embedding-3-small",
      batchLimit: 10,
      throttleMs: 0,
      nowIso: "2026-02-20T01:08:00.000Z",
    })
    expect(resumedRun.batch.scanned).toBe(1)
    expect(resumedRun.batch.enqueued).toBe(1)
    expect(resumedRun.status.status).toBe("completed")

    const status = await getEmbeddingBackfillStatus({
      turso: db,
      modelId: "openai/text-embedding-3-small",
    })
    expect(status.enqueuedCount).toBe(1)
    expect(status.estimatedRemaining).toBe(0)
  })
})

