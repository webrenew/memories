import { GRAPH_RETRIEVAL_ENABLED, type TursoClient } from "../types"

export type GraphRolloutMode = "off" | "shadow" | "canary"

export interface GraphRolloutConfig {
  mode: GraphRolloutMode
  updatedAt: string
  updatedBy: string | null
}

interface GraphRolloutMetricInput {
  nowIso: string
  mode: GraphRolloutMode
  requestedStrategy: "baseline" | "hybrid_graph"
  appliedStrategy: "baseline" | "hybrid_graph"
  shadowExecuted: boolean
  baselineCandidates: number
  graphCandidates: number
  graphExpandedCount: number
  totalCandidates: number
  fallbackTriggered: boolean
  fallbackReason: string | null
  durationMs?: number
}

export interface GraphRolloutMetricsSummary {
  windowHours: number
  totalRequests: number
  hybridRequested: number
  canaryApplied: number
  shadowExecutions: number
  fallbackCount: number
  fallbackRate: number
  graphErrorFallbacks: number
  avgGraphCandidates: number
  avgGraphExpandedCount: number
  lastFallbackAt: string | null
  lastFallbackReason: string | null
}

export type GraphRolloutQualityStatus = "pass" | "warn" | "fail" | "insufficient_data"

export interface GraphRolloutEvalWindow {
  startAt: string
  endAt: string
  totalRequests: number
  hybridRequested: number
  canaryApplied: number
  hybridFallbacks: number
  graphErrorFallbacks: number
  fallbackRate: number
  graphErrorFallbackRate: number
  canaryWithExpansion: number
  expansionCoverageRate: number
  avgExpandedCount: number
  avgCandidateLift: number
}

export interface GraphRolloutQualityReason {
  code:
    | "FALLBACK_RATE_ABOVE_LIMIT"
    | "GRAPH_ERROR_RATE_ABOVE_LIMIT"
    | "FALLBACK_RATE_REGRESSION"
    | "GRAPH_ERROR_RATE_REGRESSION"
    | "EXPANSION_COVERAGE_TOO_LOW"
    | "EXPANSION_COVERAGE_REGRESSION"
    | "CANDIDATE_LIFT_REGRESSION"
  severity: "warning" | "critical"
  blocking: boolean
  metric: "fallback_rate" | "graph_error_rate" | "expansion_coverage" | "candidate_lift"
  currentValue: number
  previousValue: number | null
  threshold: number | null
  message: string
}

export interface GraphRolloutQualitySummary {
  evaluatedAt: string
  windowHours: number
  minHybridSamples: number
  minCanarySamplesForRelevance: number
  status: GraphRolloutQualityStatus
  canaryBlocked: boolean
  reasons: GraphRolloutQualityReason[]
  current: GraphRolloutEvalWindow
  previous: GraphRolloutEvalWindow
}

const GRAPH_ROLLOUT_QUALITY_THRESHOLDS = {
  windowHours: 24,
  minHybridSamples: 20,
  minCanarySamplesForRelevance: 12,
  maxFallbackRate: 0.15,
  maxGraphErrorFallbackRate: 0.05,
  maxFallbackRateIncrease: 0.07,
  maxGraphErrorRateIncrease: 0.03,
  minExpansionCoverageRate: 0.1,
  maxExpansionCoverageDrop: 0.25,
  maxCandidateLiftDropRatio: 0.35,
} as const

const ensuredRolloutTables = new WeakSet<TursoClient>()

function isDuplicateColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  return message.includes("duplicate column name")
}

async function ensureGraphRolloutMetricColumns(turso: TursoClient): Promise<void> {
  const columns = await turso.execute("PRAGMA table_info(graph_rollout_metrics)")
  const columnRows = Array.isArray(columns.rows) ? columns.rows : []
  const hasDurationColumn = columnRows.some((row) => String((row as { name?: unknown }).name ?? "") === "duration_ms")
  if (!hasDurationColumn) {
    try {
      await turso.execute("ALTER TABLE graph_rollout_metrics ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0")
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error
      }
    }
  }
}

function normalizeRolloutMode(mode: string | null | undefined): GraphRolloutMode {
  if (mode === "off" || mode === "shadow" || mode === "canary") {
    return mode
  }
  return GRAPH_RETRIEVAL_ENABLED ? "canary" : "off"
}

function normalizeWindowHours(hours: number): number {
  if (!Number.isFinite(hours)) return 24
  return Math.max(1, Math.min(Math.floor(hours), 24 * 30))
}

function toCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toMetric(value: unknown, decimals = 4): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Number(parsed.toFixed(decimals))
}

function toRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return toMetric(numerator / denominator)
}

async function ensureGraphRolloutTables(turso: TursoClient): Promise<void> {
  if (ensuredRolloutTables.has(turso)) {
    return
  }

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS graph_rollout_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'off',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    )`
  )

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS graph_rollout_metrics (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      mode TEXT NOT NULL,
      requested_strategy TEXT NOT NULL,
      applied_strategy TEXT NOT NULL,
      shadow_executed INTEGER NOT NULL DEFAULT 0,
      baseline_candidates INTEGER NOT NULL DEFAULT 0,
      graph_candidates INTEGER NOT NULL DEFAULT 0,
      graph_expanded_count INTEGER NOT NULL DEFAULT 0,
      total_candidates INTEGER NOT NULL DEFAULT 0,
      fallback_triggered INTEGER NOT NULL DEFAULT 0,
      fallback_reason TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0
    )`
  )

  await ensureGraphRolloutMetricColumns(turso)

  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_created_at ON graph_rollout_metrics(created_at)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_mode ON graph_rollout_metrics(mode)")
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_fallback ON graph_rollout_metrics(fallback_triggered, created_at)"
  )

  ensuredRolloutTables.add(turso)
}

function emptyEvalWindow(startAt: string, endAt: string): GraphRolloutEvalWindow {
  return {
    startAt,
    endAt,
    totalRequests: 0,
    hybridRequested: 0,
    canaryApplied: 0,
    hybridFallbacks: 0,
    graphErrorFallbacks: 0,
    fallbackRate: 0,
    graphErrorFallbackRate: 0,
    canaryWithExpansion: 0,
    expansionCoverageRate: 0,
    avgExpandedCount: 0,
    avgCandidateLift: 0,
  }
}

function normalizeQualityWindowHours(hours: number | undefined): number {
  if (!Number.isFinite(hours)) return GRAPH_ROLLOUT_QUALITY_THRESHOLDS.windowHours
  return Math.max(1, Math.min(Math.floor(hours ?? GRAPH_ROLLOUT_QUALITY_THRESHOLDS.windowHours), 24 * 7))
}

export function emptyGraphRolloutQualitySummary(params: {
  nowIso: string
  windowHours?: number
}): GraphRolloutQualitySummary {
  const windowHours = normalizeQualityWindowHours(params.windowHours)
  const endAt = params.nowIso
  const startAt = new Date(Date.parse(endAt) - windowHours * 60 * 60 * 1000).toISOString()
  const previousEndAt = startAt
  const previousStartAt = new Date(Date.parse(previousEndAt) - windowHours * 60 * 60 * 1000).toISOString()
  return {
    evaluatedAt: params.nowIso,
    windowHours,
    minHybridSamples: GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minHybridSamples,
    minCanarySamplesForRelevance: GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minCanarySamplesForRelevance,
    status: "insufficient_data",
    canaryBlocked: false,
    reasons: [],
    current: emptyEvalWindow(startAt, endAt),
    previous: emptyEvalWindow(previousStartAt, previousEndAt),
  }
}

async function loadEvalWindow(
  turso: TursoClient,
  params: { startAt: string; endAt: string }
): Promise<GraphRolloutEvalWindow> {
  const summaryResult = await turso.execute({
    sql: `SELECT
            COUNT(*) as total_requests,
            SUM(CASE WHEN requested_strategy = 'hybrid_graph' THEN 1 ELSE 0 END) as hybrid_requested,
            SUM(CASE WHEN requested_strategy = 'hybrid_graph' AND applied_strategy = 'hybrid_graph' THEN 1 ELSE 0 END) as canary_applied,
            SUM(CASE WHEN requested_strategy = 'hybrid_graph' AND fallback_triggered = 1 THEN 1 ELSE 0 END) as hybrid_fallbacks,
            SUM(CASE WHEN requested_strategy = 'hybrid_graph' AND fallback_reason = 'graph_expansion_error' THEN 1 ELSE 0 END) as graph_error_fallbacks,
            SUM(CASE WHEN requested_strategy = 'hybrid_graph' AND applied_strategy = 'hybrid_graph' AND graph_expanded_count > 0 THEN 1 ELSE 0 END) as canary_with_expansion,
            AVG(CASE WHEN requested_strategy = 'hybrid_graph' AND applied_strategy = 'hybrid_graph' THEN graph_expanded_count END) as avg_expanded_count,
            AVG(
              CASE
                WHEN requested_strategy = 'hybrid_graph' AND applied_strategy = 'hybrid_graph'
                THEN CASE
                  WHEN total_candidates > baseline_candidates THEN total_candidates - baseline_candidates
                  ELSE 0
                END
              END
            ) as avg_candidate_lift
          FROM graph_rollout_metrics
          WHERE created_at >= ?
            AND created_at < ?`,
    args: [params.startAt, params.endAt],
  })

  const row = summaryResult.rows[0] as unknown as
    | {
        total_requests: number | null
        hybrid_requested: number | null
        canary_applied: number | null
        hybrid_fallbacks: number | null
        graph_error_fallbacks: number | null
        canary_with_expansion: number | null
        avg_expanded_count: number | null
        avg_candidate_lift: number | null
      }
    | undefined

  const hybridRequested = toCount(row?.hybrid_requested)
  const canaryApplied = toCount(row?.canary_applied)
  const hybridFallbacks = toCount(row?.hybrid_fallbacks)
  const graphErrorFallbacks = toCount(row?.graph_error_fallbacks)
  const canaryWithExpansion = toCount(row?.canary_with_expansion)

  return {
    startAt: params.startAt,
    endAt: params.endAt,
    totalRequests: toCount(row?.total_requests),
    hybridRequested,
    canaryApplied,
    hybridFallbacks,
    graphErrorFallbacks,
    fallbackRate: toRate(hybridFallbacks, hybridRequested),
    graphErrorFallbackRate: toRate(graphErrorFallbacks, hybridRequested),
    canaryWithExpansion,
    expansionCoverageRate: toRate(canaryWithExpansion, canaryApplied),
    avgExpandedCount: toMetric(row?.avg_expanded_count),
    avgCandidateLift: toMetric(row?.avg_candidate_lift),
  }
}

function evaluateQualityGate(params: {
  evaluatedAt: string
  windowHours: number
  current: GraphRolloutEvalWindow
  previous: GraphRolloutEvalWindow
}): GraphRolloutQualitySummary {
  const reasons: GraphRolloutQualityReason[] = []
  const { current, previous } = params

  const addReason = (reason: GraphRolloutQualityReason): void => {
    reasons.push(reason)
  }

  if (current.hybridRequested >= GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minHybridSamples) {
    if (current.fallbackRate >= GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxFallbackRate) {
      addReason({
        code: "FALLBACK_RATE_ABOVE_LIMIT",
        severity: "critical",
        blocking: true,
        metric: "fallback_rate",
        currentValue: current.fallbackRate,
        previousValue: previous.fallbackRate,
        threshold: GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxFallbackRate,
        message: `Fallback rate ${(current.fallbackRate * 100).toFixed(1)}% is above ${(
          GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxFallbackRate * 100
        ).toFixed(1)}% threshold.`,
      })
    }

    if (current.graphErrorFallbackRate >= GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxGraphErrorFallbackRate) {
      addReason({
        code: "GRAPH_ERROR_RATE_ABOVE_LIMIT",
        severity: "critical",
        blocking: true,
        metric: "graph_error_rate",
        currentValue: current.graphErrorFallbackRate,
        previousValue: previous.graphErrorFallbackRate,
        threshold: GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxGraphErrorFallbackRate,
        message: `Graph error fallback rate ${(current.graphErrorFallbackRate * 100).toFixed(1)}% is above ${(
          GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxGraphErrorFallbackRate * 100
        ).toFixed(1)}% threshold.`,
      })
    }
  }

  if (
    current.hybridRequested >= GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minHybridSamples &&
    previous.hybridRequested >= GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minHybridSamples
  ) {
    const fallbackRateDelta = current.fallbackRate - previous.fallbackRate
    if (fallbackRateDelta >= GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxFallbackRateIncrease) {
      addReason({
        code: "FALLBACK_RATE_REGRESSION",
        severity: "critical",
        blocking: true,
        metric: "fallback_rate",
        currentValue: current.fallbackRate,
        previousValue: previous.fallbackRate,
        threshold: GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxFallbackRateIncrease,
        message: `Fallback rate regressed by ${(fallbackRateDelta * 100).toFixed(1)} points window-over-window.`,
      })
    }

    const graphErrorRateDelta = current.graphErrorFallbackRate - previous.graphErrorFallbackRate
    if (graphErrorRateDelta >= GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxGraphErrorRateIncrease) {
      addReason({
        code: "GRAPH_ERROR_RATE_REGRESSION",
        severity: "critical",
        blocking: true,
        metric: "graph_error_rate",
        currentValue: current.graphErrorFallbackRate,
        previousValue: previous.graphErrorFallbackRate,
        threshold: GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxGraphErrorRateIncrease,
        message: `Graph error fallback rate regressed by ${(graphErrorRateDelta * 100).toFixed(1)} points window-over-window.`,
      })
    }
  }

  if (current.canaryApplied >= GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minCanarySamplesForRelevance) {
    if (current.expansionCoverageRate < GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minExpansionCoverageRate) {
      addReason({
        code: "EXPANSION_COVERAGE_TOO_LOW",
        severity: "warning",
        blocking: true,
        metric: "expansion_coverage",
        currentValue: current.expansionCoverageRate,
        previousValue: previous.expansionCoverageRate,
        threshold: GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minExpansionCoverageRate,
        message: `Graph expansion coverage ${(current.expansionCoverageRate * 100).toFixed(1)}% is below ${(
          GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minExpansionCoverageRate * 100
        ).toFixed(1)}% minimum.`,
      })
    }

    if (previous.canaryApplied >= GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minCanarySamplesForRelevance) {
      const coverageDrop = previous.expansionCoverageRate - current.expansionCoverageRate
      if (coverageDrop >= GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxExpansionCoverageDrop) {
        addReason({
          code: "EXPANSION_COVERAGE_REGRESSION",
          severity: "warning",
          blocking: true,
          metric: "expansion_coverage",
          currentValue: current.expansionCoverageRate,
          previousValue: previous.expansionCoverageRate,
          threshold: GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxExpansionCoverageDrop,
          message: `Graph expansion coverage dropped ${(coverageDrop * 100).toFixed(1)} points window-over-window.`,
        })
      }

      if (previous.avgCandidateLift > 0) {
        const liftFloor =
          previous.avgCandidateLift * (1 - GRAPH_ROLLOUT_QUALITY_THRESHOLDS.maxCandidateLiftDropRatio)
        if (current.avgCandidateLift < liftFloor) {
          addReason({
            code: "CANDIDATE_LIFT_REGRESSION",
            severity: "warning",
            blocking: true,
            metric: "candidate_lift",
            currentValue: current.avgCandidateLift,
            previousValue: previous.avgCandidateLift,
            threshold: liftFloor,
            message: `Average candidate lift dropped from ${previous.avgCandidateLift.toFixed(
              2
            )} to ${current.avgCandidateLift.toFixed(2)}.`,
          })
        }
      }
    }
  }

  let status: GraphRolloutQualityStatus = "pass"
  if (current.hybridRequested < GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minHybridSamples) {
    status = "insufficient_data"
  } else if (reasons.some((reason) => reason.blocking)) {
    status = "fail"
  } else if (reasons.length > 0) {
    status = "warn"
  }

  return {
    evaluatedAt: params.evaluatedAt,
    windowHours: params.windowHours,
    minHybridSamples: GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minHybridSamples,
    minCanarySamplesForRelevance: GRAPH_ROLLOUT_QUALITY_THRESHOLDS.minCanarySamplesForRelevance,
    status,
    canaryBlocked: reasons.some((reason) => reason.blocking),
    reasons,
    current,
    previous,
  }
}

export async function evaluateGraphRolloutQuality(
  turso: TursoClient,
  params: { nowIso: string; windowHours?: number }
): Promise<GraphRolloutQualitySummary> {
  await ensureGraphRolloutTables(turso)
  const windowHours = normalizeQualityWindowHours(params.windowHours)
  const currentEndAt = params.nowIso
  const currentStartAt = new Date(Date.parse(currentEndAt) - windowHours * 60 * 60 * 1000).toISOString()
  const previousEndAt = currentStartAt
  const previousStartAt = new Date(Date.parse(previousEndAt) - windowHours * 60 * 60 * 1000).toISOString()

  const [current, previous] = await Promise.all([
    loadEvalWindow(turso, { startAt: currentStartAt, endAt: currentEndAt }),
    loadEvalWindow(turso, { startAt: previousStartAt, endAt: previousEndAt }),
  ])

  return evaluateQualityGate({
    evaluatedAt: params.nowIso,
    windowHours,
    current,
    previous,
  })
}

export async function getGraphRolloutConfig(turso: TursoClient, nowIso: string): Promise<GraphRolloutConfig> {
  await ensureGraphRolloutTables(turso)

  const result = await turso.execute(
    "SELECT mode, updated_at, updated_by FROM graph_rollout_config WHERE id = 1 LIMIT 1"
  )
  const row = result.rows[0] as unknown as
    | {
        mode: string | null
        updated_at: string | null
        updated_by: string | null
      }
    | undefined

  if (row) {
    return {
      mode: normalizeRolloutMode(row.mode ?? undefined),
      updatedAt: row.updated_at ?? nowIso,
      updatedBy: row.updated_by ?? null,
    }
  }

  const mode = normalizeRolloutMode(undefined)
  await turso.execute({
    sql: `INSERT INTO graph_rollout_config (id, mode, updated_at, updated_by)
          VALUES (1, ?, ?, ?)`,
    args: [mode, nowIso, null],
  })
  return {
    mode,
    updatedAt: nowIso,
    updatedBy: null,
  }
}

export async function setGraphRolloutConfig(
  turso: TursoClient,
  params: { mode: GraphRolloutMode; nowIso: string; updatedBy: string | null }
): Promise<GraphRolloutConfig> {
  await ensureGraphRolloutTables(turso)
  const mode = normalizeRolloutMode(params.mode)

  await turso.execute({
    sql: `INSERT INTO graph_rollout_config (id, mode, updated_at, updated_by)
          VALUES (1, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            mode = excluded.mode,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,
    args: [mode, params.nowIso, params.updatedBy],
  })

  return {
    mode,
    updatedAt: params.nowIso,
    updatedBy: params.updatedBy,
  }
}

export async function recordGraphRolloutMetric(
  turso: TursoClient,
  metric: GraphRolloutMetricInput
): Promise<void> {
  await ensureGraphRolloutTables(turso)

  await turso.execute({
    sql: `INSERT INTO graph_rollout_metrics (
            id,
            created_at,
            mode,
            requested_strategy,
            applied_strategy,
            shadow_executed,
            baseline_candidates,
            graph_candidates,
            graph_expanded_count,
            total_candidates,
            fallback_triggered,
            fallback_reason,
            duration_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      metric.nowIso,
      normalizeRolloutMode(metric.mode),
      metric.requestedStrategy,
      metric.appliedStrategy,
      metric.shadowExecuted ? 1 : 0,
      Math.max(0, Math.floor(metric.baselineCandidates)),
      Math.max(0, Math.floor(metric.graphCandidates)),
      Math.max(0, Math.floor(metric.graphExpandedCount)),
      Math.max(0, Math.floor(metric.totalCandidates)),
      metric.fallbackTriggered ? 1 : 0,
      metric.fallbackReason,
      Math.max(0, Math.round(metric.durationMs ?? 0)),
    ],
  })

  await turso.execute({
    sql: "DELETE FROM graph_rollout_metrics WHERE created_at < ?",
    args: [new Date(new Date(metric.nowIso).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()],
  })
}

export async function getGraphRolloutMetricsSummary(
  turso: TursoClient,
  params: { nowIso: string; windowHours?: number }
): Promise<GraphRolloutMetricsSummary> {
  await ensureGraphRolloutTables(turso)
  const windowHours = normalizeWindowHours(params.windowHours ?? 24)
  const windowStartIso = new Date(new Date(params.nowIso).getTime() - windowHours * 60 * 60 * 1000).toISOString()

  const summaryResult = await turso.execute({
    sql: `SELECT
            COUNT(*) as total_requests,
            SUM(CASE WHEN requested_strategy = 'hybrid_graph' THEN 1 ELSE 0 END) as hybrid_requested,
            SUM(CASE WHEN applied_strategy = 'hybrid_graph' THEN 1 ELSE 0 END) as canary_applied,
            SUM(CASE WHEN shadow_executed = 1 THEN 1 ELSE 0 END) as shadow_executions,
            SUM(CASE WHEN fallback_triggered = 1 THEN 1 ELSE 0 END) as fallback_count,
            SUM(CASE WHEN fallback_reason = 'graph_expansion_error' THEN 1 ELSE 0 END) as graph_error_fallbacks,
            AVG(CASE WHEN graph_candidates IS NOT NULL THEN graph_candidates ELSE 0 END) as avg_graph_candidates,
            AVG(CASE WHEN graph_expanded_count IS NOT NULL THEN graph_expanded_count ELSE 0 END) as avg_graph_expanded_count
          FROM graph_rollout_metrics
          WHERE created_at >= ?`,
    args: [windowStartIso],
  })

  const lastFallbackResult = await turso.execute({
    sql: `SELECT created_at, fallback_reason
          FROM graph_rollout_metrics
          WHERE created_at >= ?
            AND fallback_triggered = 1
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [windowStartIso],
  })

  const row = summaryResult.rows[0] as unknown as
    | {
        total_requests: number | null
        hybrid_requested: number | null
        canary_applied: number | null
        shadow_executions: number | null
        fallback_count: number | null
        graph_error_fallbacks: number | null
        avg_graph_candidates: number | null
        avg_graph_expanded_count: number | null
      }
    | undefined

  const fallbackRow = lastFallbackResult.rows[0] as unknown as
    | {
        created_at: string | null
        fallback_reason: string | null
      }
    | undefined

  const totalRequests = toCount(row?.total_requests)
  const fallbackCount = toCount(row?.fallback_count)

  return {
    windowHours,
    totalRequests,
    hybridRequested: toCount(row?.hybrid_requested),
    canaryApplied: toCount(row?.canary_applied),
    shadowExecutions: toCount(row?.shadow_executions),
    fallbackCount,
    fallbackRate: totalRequests > 0 ? fallbackCount / totalRequests : 0,
    graphErrorFallbacks: toCount(row?.graph_error_fallbacks),
    avgGraphCandidates: Number(toCount(row?.avg_graph_candidates).toFixed(2)),
    avgGraphExpandedCount: Number(toCount(row?.avg_graph_expanded_count).toFixed(2)),
    lastFallbackAt: fallbackRow?.created_at ?? null,
    lastFallbackReason: fallbackRow?.fallback_reason ?? null,
  }
}
