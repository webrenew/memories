import { GRAPH_RETRIEVAL_ENABLED, type TursoClient } from "../types"

export type GraphRolloutMode = "off" | "shadow" | "canary"

export interface GraphRolloutConfig {
  mode: GraphRolloutMode
  updatedAt: string
  updatedBy: string | null
}

export interface GraphRolloutMetricInput {
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

const ensuredRolloutTables = new WeakSet<TursoClient>()

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

export async function ensureGraphRolloutTables(turso: TursoClient): Promise<void> {
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
      fallback_reason TEXT
    )`
  )

  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_created_at ON graph_rollout_metrics(created_at)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_mode ON graph_rollout_metrics(mode)")
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_fallback ON graph_rollout_metrics(fallback_triggered, created_at)"
  )

  ensuredRolloutTables.add(turso)
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
            fallback_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
