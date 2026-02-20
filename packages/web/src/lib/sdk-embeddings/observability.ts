import { getSdkEmbeddingJobProcessingTimeoutMs } from "@/lib/env"
import type { TursoClient } from "@/lib/memory-service/types"
import {
  listSdkEmbeddingUsage,
  type ListSdkEmbeddingUsageInput,
  type ListSdkEmbeddingUsageResult,
} from "@/lib/sdk-embedding-billing"

type AlarmSeverity = "warning" | "critical"

type SnapshotHealth = "healthy" | "degraded" | "critical"

interface EmbeddingScope {
  tenantId: string | null
  projectId: string | null
  userId: string | null
  modelId: string | null
}

export interface EmbeddingObservabilityAlarm {
  code: string
  severity: AlarmSeverity
  message: string
  observed: number
  threshold: number
  unit: "ms" | "ratio" | "count"
}

export interface EmbeddingQueueHealth {
  queuedCount: number
  processingCount: number
  deadLetterCount: number
  staleProcessingCount: number
  oldestDueAt: string | null
  oldestClaimedAt: string | null
  queueLagMs: number
}

export interface EmbeddingWorkerHealth {
  attempts: number
  successCount: number
  retryCount: number
  deadLetterCount: number
  skippedCount: number
  failureRate: number
  retryRate: number
  avgDurationMs: number
  p50DurationMs: number
  p95DurationMs: number
  durationSampleCount: number
  topErrorCodes: Array<{ code: string; count: number }>
}

export interface EmbeddingBackfillHealth {
  runs: number
  scannedCount: number
  enqueuedCount: number
  errorRuns: number
  avgDurationMs: number
  lastRunAt: string | null
  activeScopes: number
  runningScopes: number
  pausedScopes: number
}

export interface EmbeddingRetrievalHealth {
  totalRequests: number
  hybridRequested: number
  fallbackCount: number
  fallbackRate: number
  avgLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  latencySampleCount: number
  lastFallbackAt: string | null
  lastFallbackReason: string | null
}

export interface EmbeddingCostHealth {
  usageMonth: string
  requestCount: number
  inputTokens: number
  gatewayCostUsd: number
  marketCostUsd: number
  customerCostUsd: number
  customerCostPerRequestUsd: number
}

export interface EmbeddingObservabilitySnapshot {
  sampledAt: string
  windowHours: number
  scope: EmbeddingScope
  slos: typeof EMBEDDING_OBSERVABILITY_SLOS
  queue: EmbeddingQueueHealth
  worker: EmbeddingWorkerHealth
  backfill: EmbeddingBackfillHealth
  retrieval: EmbeddingRetrievalHealth
  cost: EmbeddingCostHealth
  alarms: EmbeddingObservabilityAlarm[]
  health: SnapshotHealth
}

export interface GetEmbeddingObservabilitySnapshotInput {
  turso: TursoClient
  ownerUserId: string
  nowIso?: string
  windowHours?: number
  usageMonth?: string
  tenantId?: string | null
  projectId?: string | null
  userId?: string | null
  modelId?: string | null
}

interface ObservabilityDependencies {
  usageLoader?: (input: ListSdkEmbeddingUsageInput) => Promise<ListSdkEmbeddingUsageResult>
}

const DEFAULT_WINDOW_HOURS = 24
const MAX_WINDOW_HOURS = 24 * 7

export const EMBEDDING_OBSERVABILITY_SLOS = {
  queueLagMs: {
    warning: 2 * 60 * 1_000,
    critical: 10 * 60 * 1_000,
  },
  deadLetterRate: {
    warning: 0.02,
    critical: 0.05,
    minSamples: 20,
  },
  retrievalFallbackRate: {
    warning: 0.05,
    critical: 0.15,
    minSamples: 20,
  },
  retrievalP95LatencyMs: {
    warning: 1_200,
    critical: 2_500,
    minSamples: 10,
  },
  staleProcessingCount: {
    warning: 1,
    critical: 5,
  },
  backfillErrorRuns: {
    warning: 1,
    critical: 5,
  },
} as const

function trimNullable(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toCount(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return parsed
}

function roundMetric(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(decimals))
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0
  const clamped = Math.max(0, Math.min(1, fraction))
  const index = (sortedValues.length - 1) * clamped
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sortedValues[lower] ?? 0
  const weight = index - lower
  const lowerValue = sortedValues[lower] ?? 0
  const upperValue = sortedValues[upper] ?? lowerValue
  return lowerValue + (upperValue - lowerValue) * weight
}

function normalizeWindowHours(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_WINDOW_HOURS
  return Math.max(1, Math.min(Math.floor(value ?? DEFAULT_WINDOW_HOURS), MAX_WINDOW_HOURS))
}

function toWindowStartIso(nowIso: string, windowHours: number): string {
  const windowMs = windowHours * 60 * 60 * 1_000
  return new Date(Date.parse(nowIso) - windowMs).toISOString()
}

function queueLagMs(nowIso: string, oldestDueAt: string | null): number {
  if (!oldestDueAt) return 0
  const nowMs = Date.parse(nowIso)
  const dueMs = Date.parse(oldestDueAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(dueMs)) return 0
  return Math.max(0, nowMs - dueMs)
}

function buildJobScopeClause(scope: EmbeddingScope): {
  fromClause: string
  whereClause: string
  args: string[]
} {
  const clauses: string[] = []
  const args: string[] = []
  let fromClause = "memory_embedding_jobs j"

  if (scope.projectId || scope.userId) {
    fromClause += " LEFT JOIN memories m ON m.id = j.memory_id"
    if (scope.projectId) {
      clauses.push("m.project_id = ?")
      args.push(scope.projectId)
    }
    if (scope.userId) {
      clauses.push("m.user_id = ?")
      args.push(scope.userId)
    }
  }

  if (scope.modelId) {
    clauses.push("j.model = ?")
    args.push(scope.modelId)
  }

  return {
    fromClause,
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    args,
  }
}

function buildJobMetricScopeClause(scope: EmbeddingScope, windowStartIso: string): {
  fromClause: string
  whereClause: string
  args: string[]
} {
  const clauses: string[] = ["jm.created_at >= ?"]
  const args: string[] = [windowStartIso]
  let fromClause = "memory_embedding_job_metrics jm"

  if (scope.projectId || scope.userId) {
    fromClause += " LEFT JOIN memories m ON m.id = jm.memory_id"
    if (scope.projectId) {
      clauses.push("m.project_id = ?")
      args.push(scope.projectId)
    }
    if (scope.userId) {
      clauses.push("m.user_id = ?")
      args.push(scope.userId)
    }
  }

  if (scope.modelId) {
    clauses.push("jm.model = ?")
    args.push(scope.modelId)
  }

  return {
    fromClause,
    whereClause: `WHERE ${clauses.join(" AND ")}`,
    args,
  }
}

function buildBackfillScopeClause(scope: EmbeddingScope, windowStartIso: string): {
  fromClause: string
  whereClause: string
  args: string[]
} {
  const clauses: string[] = ["bm.ran_at >= ?"]
  const args: string[] = [windowStartIso]
  const fromClause = "memory_embedding_backfill_metrics bm LEFT JOIN memory_embedding_backfill_state bs ON bs.scope_key = bm.scope_key"

  if (scope.modelId) {
    clauses.push("bm.model = ?")
    args.push(scope.modelId)
  }
  if (scope.projectId) {
    clauses.push("bs.project_id = ?")
    args.push(scope.projectId)
  }
  if (scope.userId) {
    clauses.push("bs.user_id = ?")
    args.push(scope.userId)
  }

  return {
    fromClause,
    whereClause: `WHERE ${clauses.join(" AND ")}`,
    args,
  }
}

function buildBackfillStateScopeClause(scope: EmbeddingScope): {
  whereClause: string
  args: string[]
} {
  const clauses: string[] = []
  const args: string[] = []

  if (scope.modelId) {
    clauses.push("model = ?")
    args.push(scope.modelId)
  }
  if (scope.projectId) {
    clauses.push("project_id = ?")
    args.push(scope.projectId)
  }
  if (scope.userId) {
    clauses.push("user_id = ?")
    args.push(scope.userId)
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    args,
  }
}

function buildRetrievalScopeClause(scope: EmbeddingScope, windowStartIso: string): {
  whereClause: string
  args: string[]
} {
  const clauses: string[] = ["created_at >= ?"]
  const args: string[] = [windowStartIso]

  if (scope.projectId) {
    clauses.push("project_id = ?")
    args.push(scope.projectId)
  }
  if (scope.userId) {
    clauses.push("user_id = ?")
    args.push(scope.userId)
  }
  if (scope.modelId) {
    clauses.push("semantic_model = ?")
    args.push(scope.modelId)
  }

  return {
    whereClause: `WHERE ${clauses.join(" AND ")}`,
    args,
  }
}

function isMissingDurationColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  return message.includes("duration_ms") && message.includes("no such column")
}

async function loadQueueHealth(turso: TursoClient, scope: EmbeddingScope, nowIso: string): Promise<EmbeddingQueueHealth> {
  const staleBeforeIso = new Date(Date.parse(nowIso) - getSdkEmbeddingJobProcessingTimeoutMs()).toISOString()
  const scoped = buildJobScopeClause(scope)
  const result = await turso.execute({
    sql: `SELECT
            SUM(CASE WHEN j.status = 'queued' THEN 1 ELSE 0 END) AS queued_count,
            SUM(CASE WHEN j.status = 'processing' THEN 1 ELSE 0 END) AS processing_count,
            SUM(CASE WHEN j.status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter_count,
            SUM(
              CASE
                WHEN j.status = 'processing'
                  AND j.claimed_at IS NOT NULL
                  AND j.claimed_at <= ?
                THEN 1 ELSE 0
              END
            ) AS stale_processing_count,
            MIN(CASE WHEN j.status = 'queued' THEN j.next_attempt_at END) AS oldest_due_at,
            MIN(CASE WHEN j.status = 'processing' THEN j.claimed_at END) AS oldest_claimed_at
          FROM ${scoped.fromClause}
          ${scoped.whereClause}`,
    args: [staleBeforeIso, ...scoped.args],
  })

  const row = (result.rows[0] ?? {}) as Record<string, unknown>
  const oldestDueAt = typeof row.oldest_due_at === "string" ? row.oldest_due_at : null

  return {
    queuedCount: toCount(row.queued_count),
    processingCount: toCount(row.processing_count),
    deadLetterCount: toCount(row.dead_letter_count),
    staleProcessingCount: toCount(row.stale_processing_count),
    oldestDueAt,
    oldestClaimedAt: typeof row.oldest_claimed_at === "string" ? row.oldest_claimed_at : null,
    queueLagMs: queueLagMs(nowIso, oldestDueAt),
  }
}

async function loadWorkerHealth(
  turso: TursoClient,
  scope: EmbeddingScope,
  windowStartIso: string
): Promise<EmbeddingWorkerHealth> {
  const scoped = buildJobMetricScopeClause(scope, windowStartIso)
  const summaryResult = await turso.execute({
    sql: `SELECT
            COUNT(*) AS attempts,
            SUM(CASE WHEN jm.outcome = 'success' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN jm.outcome = 'retry' THEN 1 ELSE 0 END) AS retry_count,
            SUM(CASE WHEN jm.outcome = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter_count,
            SUM(CASE WHEN jm.outcome = 'skipped' THEN 1 ELSE 0 END) AS skipped_count,
            AVG(CASE WHEN jm.duration_ms IS NOT NULL THEN jm.duration_ms END) AS avg_duration_ms
          FROM ${scoped.fromClause}
          ${scoped.whereClause}`,
    args: scoped.args,
  })

  const durationsResult = await turso.execute({
    sql: `SELECT jm.duration_ms AS duration_ms
          FROM ${scoped.fromClause}
          ${scoped.whereClause}
          ORDER BY jm.duration_ms ASC`,
    args: scoped.args,
  })

  const errorResult = await turso.execute({
    sql: `SELECT jm.error_code AS error_code, COUNT(*) AS count
          FROM ${scoped.fromClause}
          ${scoped.whereClause}
            AND jm.error_code IS NOT NULL
            AND jm.error_code <> ''
          GROUP BY jm.error_code
          ORDER BY count DESC
          LIMIT 5`,
    args: scoped.args,
  })

  const row = (summaryResult.rows[0] ?? {}) as Record<string, unknown>
  const attempts = toCount(row.attempts)
  const retryCount = toCount(row.retry_count)
  const deadLetterCount = toCount(row.dead_letter_count)
  const durations = durationsResult.rows
    .map((durationRow) => toNumber((durationRow as Record<string, unknown>).duration_ms))
    .filter((value) => value >= 0)

  return {
    attempts,
    successCount: toCount(row.success_count),
    retryCount,
    deadLetterCount,
    skippedCount: toCount(row.skipped_count),
    failureRate: attempts > 0 ? roundMetric(deadLetterCount / attempts) : 0,
    retryRate: attempts > 0 ? roundMetric(retryCount / attempts) : 0,
    avgDurationMs: roundMetric(toNumber(row.avg_duration_ms), 2),
    p50DurationMs: roundMetric(percentile(durations, 0.5), 2),
    p95DurationMs: roundMetric(percentile(durations, 0.95), 2),
    durationSampleCount: durations.length,
    topErrorCodes: errorResult.rows.map((errorRow) => {
      const record = errorRow as Record<string, unknown>
      return {
        code: String(record.error_code ?? "UNKNOWN"),
        count: toCount(record.count),
      }
    }),
  }
}

async function loadBackfillHealth(
  turso: TursoClient,
  scope: EmbeddingScope,
  windowStartIso: string
): Promise<EmbeddingBackfillHealth> {
  const metricsScope = buildBackfillScopeClause(scope, windowStartIso)
  const summaryResult = await turso.execute({
    sql: `SELECT
            COUNT(*) AS runs,
            SUM(bm.batch_scanned) AS scanned_count,
            SUM(bm.batch_enqueued) AS enqueued_count,
            SUM(CASE WHEN bm.error IS NOT NULL AND TRIM(bm.error) <> '' THEN 1 ELSE 0 END) AS error_runs,
            AVG(CASE WHEN bm.duration_ms IS NOT NULL THEN bm.duration_ms END) AS avg_duration_ms,
            MAX(bm.ran_at) AS last_run_at
          FROM ${metricsScope.fromClause}
          ${metricsScope.whereClause}`,
    args: metricsScope.args,
  })

  const stateScope = buildBackfillStateScopeClause(scope)
  const stateResult = await turso.execute({
    sql: `SELECT status, COUNT(*) AS count
          FROM memory_embedding_backfill_state
          ${stateScope.whereClause}
          GROUP BY status`,
    args: stateScope.args,
  })

  const summaryRow = (summaryResult.rows[0] ?? {}) as Record<string, unknown>
  let runningScopes = 0
  let pausedScopes = 0
  for (const stateRow of stateResult.rows) {
    const record = stateRow as Record<string, unknown>
    if (record.status === "running") runningScopes = toCount(record.count)
    if (record.status === "paused") pausedScopes = toCount(record.count)
  }

  return {
    runs: toCount(summaryRow.runs),
    scannedCount: toCount(summaryRow.scanned_count),
    enqueuedCount: toCount(summaryRow.enqueued_count),
    errorRuns: toCount(summaryRow.error_runs),
    avgDurationMs: roundMetric(toNumber(summaryRow.avg_duration_ms), 2),
    lastRunAt: typeof summaryRow.last_run_at === "string" ? summaryRow.last_run_at : null,
    activeScopes: runningScopes + pausedScopes,
    runningScopes,
    pausedScopes,
  }
}

async function loadRetrievalHealth(
  turso: TursoClient,
  scope: EmbeddingScope,
  windowStartIso: string
): Promise<EmbeddingRetrievalHealth> {
  let summaryResult: Awaited<ReturnType<TursoClient["execute"]>>
  let durationRows: unknown[] = []
  const scoped = buildRetrievalScopeClause(scope, windowStartIso)

  try {
    summaryResult = await turso.execute({
      sql: `SELECT
              COUNT(*) AS total_requests,
              SUM(CASE WHEN requested_strategy = 'hybrid_graph' THEN 1 ELSE 0 END) AS hybrid_requested,
              SUM(CASE WHEN requested_strategy = 'hybrid_graph' AND fallback_triggered = 1 THEN 1 ELSE 0 END) AS fallback_count,
              AVG(CASE WHEN duration_ms > 0 THEN duration_ms END) AS avg_duration_ms
            FROM graph_rollout_metrics
            ${scoped.whereClause}`,
      args: scoped.args,
    })

    const durationsResult = await turso.execute({
      sql: `SELECT duration_ms
            FROM graph_rollout_metrics
            ${scoped.whereClause}
              AND duration_ms > 0
            ORDER BY duration_ms ASC`,
      args: scoped.args,
    })
    durationRows = Array.isArray(durationsResult.rows) ? durationsResult.rows : []
  } catch (error) {
    if (!isMissingDurationColumnError(error)) {
      throw error
    }

    summaryResult = await turso.execute({
      sql: `SELECT
              COUNT(*) AS total_requests,
              SUM(CASE WHEN requested_strategy = 'hybrid_graph' THEN 1 ELSE 0 END) AS hybrid_requested,
              SUM(CASE WHEN requested_strategy = 'hybrid_graph' AND fallback_triggered = 1 THEN 1 ELSE 0 END) AS fallback_count
            FROM graph_rollout_metrics
            ${scoped.whereClause}`,
      args: scoped.args,
    })

    durationRows = []
  }

  const fallbackResult = await turso.execute({
    sql: `SELECT created_at, fallback_reason
          FROM graph_rollout_metrics
          ${scoped.whereClause}
            AND requested_strategy = 'hybrid_graph'
            AND fallback_triggered = 1
          ORDER BY created_at DESC
          LIMIT 1`,
    args: scoped.args,
  })

  const row = (summaryResult.rows[0] ?? {}) as Record<string, unknown>
  const durations = durationRows
    .map((durationRow) => toNumber((durationRow as Record<string, unknown>).duration_ms))
    .filter((value) => value > 0)
  const totalRequests = toCount(row.total_requests)
  const hybridRequested = toCount(row.hybrid_requested)
  const fallbackCount = toCount(row.fallback_count)
  const fallbackRow = (fallbackResult.rows[0] ?? {}) as Record<string, unknown>

  return {
    totalRequests,
    hybridRequested,
    fallbackCount,
    fallbackRate: hybridRequested > 0 ? roundMetric(fallbackCount / hybridRequested) : 0,
    avgLatencyMs: roundMetric(toNumber(row.avg_duration_ms), 2),
    p50LatencyMs: roundMetric(percentile(durations, 0.5), 2),
    p95LatencyMs: roundMetric(percentile(durations, 0.95), 2),
    latencySampleCount: durations.length,
    lastFallbackAt: typeof fallbackRow.created_at === "string" ? fallbackRow.created_at : null,
    lastFallbackReason: typeof fallbackRow.fallback_reason === "string" ? fallbackRow.fallback_reason : null,
  }
}

async function loadCostHealth(
  input: GetEmbeddingObservabilitySnapshotInput,
  usageLoader: (input: ListSdkEmbeddingUsageInput) => Promise<ListSdkEmbeddingUsageResult>
): Promise<EmbeddingCostHealth> {
  const usage = await usageLoader({
    ownerUserId: input.ownerUserId,
    usageMonth: input.usageMonth,
    tenantId: trimNullable(input.tenantId ?? null) ?? undefined,
    projectId: trimNullable(input.projectId ?? null) ?? undefined,
    userId: trimNullable(input.userId ?? null) ?? undefined,
    modelId: trimNullable(input.modelId ?? null) ?? undefined,
    summaryOnly: true,
  })

  const requestCount = Math.max(0, usage.summary.requestCount)
  const customerCostUsd = Math.max(0, usage.summary.customerCostUsd)
  return {
    usageMonth: usage.usageMonth,
    requestCount,
    inputTokens: Math.max(0, usage.summary.inputTokens),
    gatewayCostUsd: Math.max(0, usage.summary.gatewayCostUsd),
    marketCostUsd: Math.max(0, usage.summary.marketCostUsd),
    customerCostUsd,
    customerCostPerRequestUsd: requestCount > 0 ? roundMetric(customerCostUsd / requestCount, 8) : 0,
  }
}

function evaluateAlarms(snapshot: {
  queue: EmbeddingQueueHealth
  worker: EmbeddingWorkerHealth
  backfill: EmbeddingBackfillHealth
  retrieval: EmbeddingRetrievalHealth
}): { alarms: EmbeddingObservabilityAlarm[]; health: SnapshotHealth } {
  const alarms: EmbeddingObservabilityAlarm[] = []

  const pushAlarm = (
    code: string,
    severity: AlarmSeverity,
    message: string,
    observed: number,
    threshold: number,
    unit: "ms" | "ratio" | "count"
  ) => {
    alarms.push({ code, severity, message, observed, threshold, unit })
  }

  if (snapshot.queue.queueLagMs >= EMBEDDING_OBSERVABILITY_SLOS.queueLagMs.critical) {
    pushAlarm(
      "EMBEDDING_QUEUE_LAG_CRITICAL",
      "critical",
      "Embedding queue lag exceeds critical SLO.",
      snapshot.queue.queueLagMs,
      EMBEDDING_OBSERVABILITY_SLOS.queueLagMs.critical,
      "ms"
    )
  } else if (snapshot.queue.queueLagMs >= EMBEDDING_OBSERVABILITY_SLOS.queueLagMs.warning) {
    pushAlarm(
      "EMBEDDING_QUEUE_LAG_WARNING",
      "warning",
      "Embedding queue lag exceeds warning SLO.",
      snapshot.queue.queueLagMs,
      EMBEDDING_OBSERVABILITY_SLOS.queueLagMs.warning,
      "ms"
    )
  }

  if (snapshot.queue.staleProcessingCount >= EMBEDDING_OBSERVABILITY_SLOS.staleProcessingCount.critical) {
    pushAlarm(
      "EMBEDDING_STALE_JOBS_CRITICAL",
      "critical",
      "Too many embedding jobs are stuck in processing state.",
      snapshot.queue.staleProcessingCount,
      EMBEDDING_OBSERVABILITY_SLOS.staleProcessingCount.critical,
      "count"
    )
  } else if (snapshot.queue.staleProcessingCount >= EMBEDDING_OBSERVABILITY_SLOS.staleProcessingCount.warning) {
    pushAlarm(
      "EMBEDDING_STALE_JOBS_WARNING",
      "warning",
      "Some embedding jobs appear stuck in processing state.",
      snapshot.queue.staleProcessingCount,
      EMBEDDING_OBSERVABILITY_SLOS.staleProcessingCount.warning,
      "count"
    )
  }

  if (snapshot.worker.attempts >= EMBEDDING_OBSERVABILITY_SLOS.deadLetterRate.minSamples) {
    if (snapshot.worker.failureRate >= EMBEDDING_OBSERVABILITY_SLOS.deadLetterRate.critical) {
      pushAlarm(
        "EMBEDDING_DEAD_LETTER_RATE_CRITICAL",
        "critical",
        "Embedding dead-letter rate exceeds critical SLO.",
        snapshot.worker.failureRate,
        EMBEDDING_OBSERVABILITY_SLOS.deadLetterRate.critical,
        "ratio"
      )
    } else if (snapshot.worker.failureRate >= EMBEDDING_OBSERVABILITY_SLOS.deadLetterRate.warning) {
      pushAlarm(
        "EMBEDDING_DEAD_LETTER_RATE_WARNING",
        "warning",
        "Embedding dead-letter rate exceeds warning SLO.",
        snapshot.worker.failureRate,
        EMBEDDING_OBSERVABILITY_SLOS.deadLetterRate.warning,
        "ratio"
      )
    }
  }

  if (snapshot.retrieval.hybridRequested >= EMBEDDING_OBSERVABILITY_SLOS.retrievalFallbackRate.minSamples) {
    if (snapshot.retrieval.fallbackRate >= EMBEDDING_OBSERVABILITY_SLOS.retrievalFallbackRate.critical) {
      pushAlarm(
        "EMBEDDING_RETRIEVAL_FALLBACK_RATE_CRITICAL",
        "critical",
        "Retrieval fallback rate exceeds critical SLO.",
        snapshot.retrieval.fallbackRate,
        EMBEDDING_OBSERVABILITY_SLOS.retrievalFallbackRate.critical,
        "ratio"
      )
    } else if (snapshot.retrieval.fallbackRate >= EMBEDDING_OBSERVABILITY_SLOS.retrievalFallbackRate.warning) {
      pushAlarm(
        "EMBEDDING_RETRIEVAL_FALLBACK_RATE_WARNING",
        "warning",
        "Retrieval fallback rate exceeds warning SLO.",
        snapshot.retrieval.fallbackRate,
        EMBEDDING_OBSERVABILITY_SLOS.retrievalFallbackRate.warning,
        "ratio"
      )
    }
  }

  if (snapshot.retrieval.latencySampleCount >= EMBEDDING_OBSERVABILITY_SLOS.retrievalP95LatencyMs.minSamples) {
    if (snapshot.retrieval.p95LatencyMs >= EMBEDDING_OBSERVABILITY_SLOS.retrievalP95LatencyMs.critical) {
      pushAlarm(
        "EMBEDDING_RETRIEVAL_LATENCY_CRITICAL",
        "critical",
        "Retrieval p95 latency exceeds critical SLO.",
        snapshot.retrieval.p95LatencyMs,
        EMBEDDING_OBSERVABILITY_SLOS.retrievalP95LatencyMs.critical,
        "ms"
      )
    } else if (snapshot.retrieval.p95LatencyMs >= EMBEDDING_OBSERVABILITY_SLOS.retrievalP95LatencyMs.warning) {
      pushAlarm(
        "EMBEDDING_RETRIEVAL_LATENCY_WARNING",
        "warning",
        "Retrieval p95 latency exceeds warning SLO.",
        snapshot.retrieval.p95LatencyMs,
        EMBEDDING_OBSERVABILITY_SLOS.retrievalP95LatencyMs.warning,
        "ms"
      )
    }
  }

  if (snapshot.backfill.errorRuns >= EMBEDDING_OBSERVABILITY_SLOS.backfillErrorRuns.critical) {
    pushAlarm(
      "EMBEDDING_BACKFILL_ERRORS_CRITICAL",
      "critical",
      "Backfill batch errors exceed critical threshold.",
      snapshot.backfill.errorRuns,
      EMBEDDING_OBSERVABILITY_SLOS.backfillErrorRuns.critical,
      "count"
    )
  } else if (snapshot.backfill.errorRuns >= EMBEDDING_OBSERVABILITY_SLOS.backfillErrorRuns.warning) {
    pushAlarm(
      "EMBEDDING_BACKFILL_ERRORS_WARNING",
      "warning",
      "Backfill batch errors detected in the observation window.",
      snapshot.backfill.errorRuns,
      EMBEDDING_OBSERVABILITY_SLOS.backfillErrorRuns.warning,
      "count"
    )
  }

  const health: SnapshotHealth = alarms.some((alarm) => alarm.severity === "critical")
    ? "critical"
    : alarms.length > 0
      ? "degraded"
      : "healthy"

  return { alarms, health }
}

export async function getEmbeddingObservabilitySnapshot(
  input: GetEmbeddingObservabilitySnapshotInput,
  dependencies: ObservabilityDependencies = {}
): Promise<EmbeddingObservabilitySnapshot> {
  const nowIso = input.nowIso ?? new Date().toISOString()
  const windowHours = normalizeWindowHours(input.windowHours)
  const windowStartIso = toWindowStartIso(nowIso, windowHours)
  const scope: EmbeddingScope = {
    tenantId: trimNullable(input.tenantId ?? null),
    projectId: trimNullable(input.projectId ?? null),
    userId: trimNullable(input.userId ?? null),
    modelId: trimNullable(input.modelId ?? null),
  }
  const usageLoader = dependencies.usageLoader ?? listSdkEmbeddingUsage

  const [queue, worker, backfill, retrieval, cost] = await Promise.all([
    loadQueueHealth(input.turso, scope, nowIso),
    loadWorkerHealth(input.turso, scope, windowStartIso),
    loadBackfillHealth(input.turso, scope, windowStartIso),
    loadRetrievalHealth(input.turso, scope, windowStartIso),
    loadCostHealth(input, usageLoader),
  ])

  const { alarms, health } = evaluateAlarms({
    queue,
    worker,
    backfill,
    retrieval,
  })

  return {
    sampledAt: nowIso,
    windowHours,
    scope,
    slos: EMBEDDING_OBSERVABILITY_SLOS,
    queue,
    worker,
    backfill,
    retrieval,
    cost,
    alarms,
    health,
  }
}
