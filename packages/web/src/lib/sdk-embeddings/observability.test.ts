import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/scope-schema"
import { recordGraphRolloutMetric } from "@/lib/memory-service/graph/rollout"
import { getEmbeddingObservabilitySnapshot } from "./observability"

type DbClient = ReturnType<typeof createClient>

const testDatabases: DbClient[] = []

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "embedding-observability.db")}` })
  testDatabases.push(db)

  await db.execute(
    `CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      user_id TEXT,
      tags TEXT,
      paths TEXT,
      category TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`
  )

  await ensureMemoryUserIdSchema(db, { cacheKey: `observability:${prefix}:${Date.now()}` })
  return db
}

async function insertMemory(db: DbClient, input: { id: string; projectId?: string | null; userId?: string | null }): Promise<void> {
  await db.execute({
    sql: `INSERT INTO memories (
            id, content, type, memory_layer, expires_at, scope, project_id, user_id,
            tags, paths, category, metadata, deleted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id,
      `Memory ${input.id}`,
      "note",
      "long_term",
      null,
      "global",
      input.projectId ?? null,
      input.userId ?? null,
      null,
      null,
      null,
      null,
      null,
      "2026-02-20T00:00:00.000Z",
      "2026-02-20T00:00:00.000Z",
    ],
  })
}

async function insertJob(
  db: DbClient,
  input: {
    id: string
    memoryId: string
    status: "queued" | "processing" | "dead_letter" | "succeeded"
    nowIso: string
    nextAttemptAt?: string
    claimedAt?: string | null
  }
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO memory_embedding_jobs (
            id, memory_id, operation, model, content, model_version, status,
            attempt_count, max_attempts, next_attempt_at, claimed_by, claimed_at,
            last_error, dead_letter_reason, dead_letter_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id,
      input.memoryId,
      "add",
      "openai/text-embedding-3-small",
      `job-${input.id}`,
      "2026-02-01",
      input.status,
      1,
      5,
      input.nextAttemptAt ?? input.nowIso,
      input.status === "processing" ? "worker-1" : null,
      input.claimedAt ?? null,
      input.status === "dead_letter" ? "failed" : null,
      input.status === "dead_letter" ? "failed" : null,
      input.status === "dead_letter" ? input.nowIso : null,
      input.nowIso,
      input.nowIso,
    ],
  })
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
})

describe("getEmbeddingObservabilitySnapshot", () => {
  it("aggregates queue, worker, backfill, retrieval, and cost signals into alarms", async () => {
    const db = await setupDb("memories-embedding-observability-alerts")
    const nowIso = "2026-02-20T12:00:00.000Z"

    await insertMemory(db, { id: "mem-1", projectId: "project-a", userId: "user-a" })
    await insertMemory(db, { id: "mem-2", projectId: "project-a", userId: "user-a" })
    await insertMemory(db, { id: "mem-3", projectId: "project-a", userId: "user-a" })

    await insertJob(db, {
      id: "job-queued",
      memoryId: "mem-1",
      status: "queued",
      nowIso,
      nextAttemptAt: "2026-02-20T11:40:00.000Z",
    })
    await insertJob(db, {
      id: "job-processing",
      memoryId: "mem-2",
      status: "processing",
      nowIso,
      claimedAt: "2026-02-20T11:45:00.000Z",
    })
    await insertJob(db, {
      id: "job-dead",
      memoryId: "mem-3",
      status: "dead_letter",
      nowIso,
    })

    for (let index = 0; index < 40; index += 1) {
      const outcome = index < 3 ? "dead_letter" : index < 8 ? "retry" : "success"
      await db.execute({
        sql: `INSERT INTO memory_embedding_job_metrics (
                id, job_id, memory_id, operation, model, attempt, outcome, duration_ms, error_code, error_message, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `metric-${index}`,
          `job-${index}`,
          index % 2 === 0 ? "mem-1" : "mem-2",
          "add",
          "openai/text-embedding-3-small",
          1,
          outcome,
          200 + index * 50,
          outcome === "dead_letter" ? "EMBEDDING_GATEWAY_HTTP_500" : null,
          outcome === "dead_letter" ? "gateway failed" : null,
          `2026-02-20T11:${(index % 60).toString().padStart(2, "0")}:00.000Z`,
        ],
      })
    }

    await db.execute({
      sql: `INSERT INTO memory_embedding_backfill_metrics (
              id, scope_key, model, batch_scanned, batch_enqueued, total_scanned, total_enqueued,
              estimated_total, estimated_remaining, estimated_completion_seconds, duration_ms, status, error, ran_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "backfill-metric-1",
        "openai/text-embedding-3-small|project-a|user-a",
        "openai/text-embedding-3-small",
        20,
        20,
        20,
        20,
        100,
        80,
        120,
        400,
        "running",
        "queue busy",
        "2026-02-20T11:55:00.000Z",
      ],
    })

    await db.execute({
      sql: `INSERT INTO memory_embedding_backfill_state (
              scope_key, model, project_id, user_id, status, scanned_count, enqueued_count, estimated_total, estimated_remaining,
              estimated_completion_seconds, batch_limit, throttle_ms, started_at, last_run_at, completed_at, updated_at, last_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "openai/text-embedding-3-small|project-a|user-a",
        "openai/text-embedding-3-small",
        "project-a",
        "user-a",
        "running",
        20,
        20,
        100,
        80,
        120,
        100,
        25,
        "2026-02-20T11:50:00.000Z",
        "2026-02-20T11:55:00.000Z",
        null,
        "2026-02-20T11:55:00.000Z",
        null,
      ],
    })

    for (let index = 0; index < 30; index += 1) {
      const fallbackTriggered = index < 6
      await recordGraphRolloutMetric(db, {
        nowIso: `2026-02-20T11:${index.toString().padStart(2, "0")}:30.000Z`,
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
        durationMs: 400 + index * 90,
        projectId: "project-a",
        userId: "user-a",
        semanticModelId: "openai/text-embedding-3-small",
      })
    }

    const usageLoader = vi.fn().mockResolvedValue({
      usageMonth: "2026-02-01",
      summary: {
        usageMonth: "2026-02-01",
        requestCount: 120,
        estimatedRequestCount: 0,
        tokenizerRequestCount: 120,
        fallbackRequestCount: 0,
        inputTokensDelta: 0,
        inputTokens: 60_000,
        gatewayCostUsd: 0.3,
        marketCostUsd: 0.28,
        customerCostUsd: 0.34,
      },
      breakdown: [],
    })

    const snapshot = await getEmbeddingObservabilitySnapshot(
      {
        turso: db,
        ownerUserId: "owner-1",
        tenantId: "tenant-a",
        projectId: "project-a",
        userId: "user-a",
        modelId: "openai/text-embedding-3-small",
        nowIso,
        windowHours: 24,
      },
      { usageLoader }
    )

    expect(snapshot.queue.queuedCount).toBe(1)
    expect(snapshot.queue.staleProcessingCount).toBe(1)
    expect(snapshot.queue.queueLagMs).toBeGreaterThanOrEqual(20 * 60 * 1_000)
    expect(snapshot.worker.attempts).toBe(40)
    expect(snapshot.worker.failureRate).toBeGreaterThan(0.05)
    expect(snapshot.retrieval.totalRequests).toBe(30)
    expect(snapshot.retrieval.fallbackRate).toBe(0.2)
    expect(snapshot.retrieval.p95LatencyMs).toBeGreaterThan(2_500)
    expect(snapshot.health).toBe("critical")
    expect(snapshot.alarms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "EMBEDDING_DEAD_LETTER_RATE_CRITICAL", severity: "critical" }),
        expect.objectContaining({ code: "EMBEDDING_RETRIEVAL_FALLBACK_RATE_CRITICAL", severity: "critical" }),
        expect.objectContaining({ code: "EMBEDDING_RETRIEVAL_LATENCY_CRITICAL", severity: "critical" }),
      ])
    )
    expect(usageLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        tenantId: "tenant-a",
        projectId: "project-a",
        userId: "user-a",
        modelId: "openai/text-embedding-3-small",
        summaryOnly: true,
      })
    )
  })

  it("returns a healthy snapshot when no signal exceeds SLOs", async () => {
    const db = await setupDb("memories-embedding-observability-healthy")

    const snapshot = await getEmbeddingObservabilitySnapshot(
      {
        turso: db,
        ownerUserId: "owner-healthy",
        nowIso: "2026-02-20T12:00:00.000Z",
      },
      {
        usageLoader: async () => ({
          usageMonth: "2026-02-01",
          summary: {
            usageMonth: "2026-02-01",
            requestCount: 0,
            estimatedRequestCount: 0,
            tokenizerRequestCount: 0,
            fallbackRequestCount: 0,
            inputTokensDelta: 0,
            inputTokens: 0,
            gatewayCostUsd: 0,
            marketCostUsd: 0,
            customerCostUsd: 0,
          },
          breakdown: [],
        }),
      }
    )

    expect(snapshot.health).toBe("healthy")
    expect(snapshot.alarms).toEqual([])
    expect(snapshot.queue.queuedCount).toBe(0)
    expect(snapshot.worker.attempts).toBe(0)
    expect(snapshot.retrieval.totalRequests).toBe(0)
  })

  it("scopes retrieval metrics by project/user/model and computes fallback rate from hybrid requests", async () => {
    const db = await setupDb("memories-embedding-observability-retrieval-scope")

    await recordGraphRolloutMetric(db, {
      nowIso: "2026-02-20T11:00:00.000Z",
      mode: "canary",
      requestedStrategy: "hybrid_graph",
      appliedStrategy: "baseline",
      shadowExecuted: false,
      baselineCandidates: 3,
      graphCandidates: 1,
      graphExpandedCount: 0,
      totalCandidates: 3,
      fallbackTriggered: true,
      fallbackReason: "graph_expansion_error",
      durationMs: 900,
      projectId: "project-a",
      userId: "user-a",
      semanticModelId: "openai/text-embedding-3-small",
    })
    await recordGraphRolloutMetric(db, {
      nowIso: "2026-02-20T11:01:00.000Z",
      mode: "canary",
      requestedStrategy: "hybrid_graph",
      appliedStrategy: "hybrid_graph",
      shadowExecuted: false,
      baselineCandidates: 3,
      graphCandidates: 2,
      graphExpandedCount: 1,
      totalCandidates: 4,
      fallbackTriggered: false,
      fallbackReason: null,
      durationMs: 850,
      projectId: "project-a",
      userId: "user-a",
      semanticModelId: "openai/text-embedding-3-small",
    })
    for (let index = 0; index < 8; index += 1) {
      await recordGraphRolloutMetric(db, {
        nowIso: `2026-02-20T11:${(index + 2).toString().padStart(2, "0")}:00.000Z`,
        mode: "canary",
        requestedStrategy: "baseline",
        appliedStrategy: "baseline",
        shadowExecuted: false,
        baselineCandidates: 2,
        graphCandidates: 0,
        graphExpandedCount: 0,
        totalCandidates: 2,
        fallbackTriggered: false,
        fallbackReason: null,
        durationMs: 100,
        projectId: "project-a",
        userId: "user-a",
        semanticModelId: "openai/text-embedding-3-small",
      })
    }
    await recordGraphRolloutMetric(db, {
      nowIso: "2026-02-20T11:20:00.000Z",
      mode: "canary",
      requestedStrategy: "hybrid_graph",
      appliedStrategy: "baseline",
      shadowExecuted: false,
      baselineCandidates: 3,
      graphCandidates: 1,
      graphExpandedCount: 0,
      totalCandidates: 3,
      fallbackTriggered: true,
      fallbackReason: "graph_expansion_error",
      durationMs: 1_200,
      projectId: "project-b",
      userId: "user-b",
      semanticModelId: "openai/text-embedding-3-small",
    })

    const snapshot = await getEmbeddingObservabilitySnapshot(
      {
        turso: db,
        ownerUserId: "owner-retrieval",
        projectId: "project-a",
        userId: "user-a",
        modelId: "openai/text-embedding-3-small",
        nowIso: "2026-02-20T12:00:00.000Z",
        windowHours: 24,
      },
      {
        usageLoader: async () => ({
          usageMonth: "2026-02-01",
          summary: {
            usageMonth: "2026-02-01",
            requestCount: 0,
            estimatedRequestCount: 0,
            tokenizerRequestCount: 0,
            fallbackRequestCount: 0,
            inputTokensDelta: 0,
            inputTokens: 0,
            gatewayCostUsd: 0,
            marketCostUsd: 0,
            customerCostUsd: 0,
          },
          breakdown: [],
        }),
      }
    )

    expect(snapshot.retrieval.totalRequests).toBe(10)
    expect(snapshot.retrieval.hybridRequested).toBe(2)
    expect(snapshot.retrieval.fallbackCount).toBe(1)
    expect(snapshot.retrieval.fallbackRate).toBe(0.5)
  })
})
