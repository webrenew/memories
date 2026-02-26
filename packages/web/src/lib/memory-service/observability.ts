import type { TursoClient } from "./types"

type AlarmSeverity = "warning" | "critical"
type SnapshotHealth = "healthy" | "degraded" | "critical"
type TrendDirection = "up" | "down" | "flat"

interface ObservabilityScope {
  tenantId: string | null
  projectId: string | null
  userId: string | null
}

interface ScopeFilterResult {
  clause: string
  args: string[]
}

export interface MemoryLifecycleObservabilityAlarm {
  code: string
  severity: AlarmSeverity
  message: string
  observed: number
  threshold: number
  unit: "ratio" | "count"
}

export interface MemoryLifecycleObservabilitySnapshot {
  sampledAt: string
  windowHours: number
  scope: ObservabilityScope
  lifecycle: {
    createdCount: number
    updatedCount: number
    deletedCount: number
    activeCount: number
    totalCount: number
  }
  compaction: {
    totalEvents: number
    byTrigger: { count: number; time: number; semantic: number }
    compactedSessions: number
    checkpointMissingCount: number
    checkpointCoverage: number
  }
  consolidation: {
    runCount: number
    mergedCount: number
    supersededCount: number
    conflictedCount: number
    conflictRate: number
    lastRunAt: string | null
  }
  contradictions: {
    totalCount: number
    windowCount: number
    trend: TrendDirection
    daily: Array<{ date: string; count: number }>
  }
  alarms: MemoryLifecycleObservabilityAlarm[]
  health: SnapshotHealth
}

export interface GetMemoryLifecycleObservabilitySnapshotInput {
  turso: TursoClient
  nowIso?: string
  windowHours?: number
  tenantId?: string | null
  projectId?: string | null
  userId?: string | null
}

const DEFAULT_WINDOW_HOURS = 24
const MAX_WINDOW_HOURS = 24 * 14

const MEMORY_OBSERVABILITY_SLOS = {
  checkpointCoverage: {
    warning: 0.9,
    critical: 0.75,
    minSamples: 5,
  },
  consolidationConflictRate: {
    warning: 0.4,
    critical: 0.7,
    minSamples: 3,
  },
  contradictionWindowCount: {
    warning: 5,
    critical: 12,
  },
} as const

function trimNullable(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return parsed
}

function toCount(value: unknown): number {
  const parsed = toNumber(value)
  if (parsed <= 0) return 0
  return Math.floor(parsed)
}

function roundMetric(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(decimals))
}

function normalizeWindowHours(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_WINDOW_HOURS
  return Math.max(1, Math.min(Math.floor(value ?? DEFAULT_WINDOW_HOURS), MAX_WINDOW_HOURS))
}

function toWindowStartIso(nowIso: string, windowHours: number): string {
  return new Date(Date.parse(nowIso) - windowHours * 60 * 60 * 1_000).toISOString()
}

function buildScopeFilter(params: {
  projectId: string | null
  userId: string | null
  alias?: string
}): ScopeFilterResult {
  const alias = params.alias ? `${params.alias}.` : ""
  const clauses: string[] = []
  const args: string[] = []

  if (params.projectId) {
    clauses.push(`${alias}project_id = ?`)
    args.push(params.projectId)
  }
  if (params.userId) {
    clauses.push(`${alias}user_id = ?`)
    args.push(params.userId)
  }

  return {
    clause: clauses.length > 0 ? clauses.join(" AND ") : "1 = 1",
    args,
  }
}

async function tableExists(turso: TursoClient, tableName: string): Promise<boolean> {
  const result = await turso.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    args: [tableName],
  })
  return result.rows.length > 0
}

async function queryScalarCount(
  turso: TursoClient,
  sql: string,
  args: (string | number)[]
): Promise<number> {
  const result = await turso.execute({ sql, args })
  return toCount(result.rows[0]?.count ?? 0)
}

function computeTrend(daily: Array<{ date: string; count: number }>): TrendDirection {
  if (daily.length < 2) return "flat"
  const midpoint = Math.floor(daily.length / 2)
  const first = daily.slice(0, midpoint)
  const second = daily.slice(midpoint)
  const avg = (values: Array<{ count: number }>) =>
    values.length > 0 ? values.reduce((sum, item) => sum + item.count, 0) / values.length : 0
  const firstAvg = avg(first)
  const secondAvg = avg(second)
  if (secondAvg > firstAvg * 1.1) return "up"
  if (secondAvg < firstAvg * 0.9) return "down"
  return "flat"
}

function deriveHealth(alarms: MemoryLifecycleObservabilityAlarm[]): SnapshotHealth {
  if (alarms.some((alarm) => alarm.severity === "critical")) return "critical"
  if (alarms.some((alarm) => alarm.severity === "warning")) return "degraded"
  return "healthy"
}

export async function getMemoryLifecycleObservabilitySnapshot(
  input: GetMemoryLifecycleObservabilitySnapshotInput
): Promise<MemoryLifecycleObservabilitySnapshot> {
  const nowIso = trimNullable(input.nowIso) ?? new Date().toISOString()
  const windowHours = normalizeWindowHours(input.windowHours)
  const windowStartIso = toWindowStartIso(nowIso, windowHours)
  const scope: ObservabilityScope = {
    tenantId: trimNullable(input.tenantId) ?? null,
    projectId: trimNullable(input.projectId) ?? null,
    userId: trimNullable(input.userId) ?? null,
  }

  const memoryScope = buildScopeFilter({ projectId: scope.projectId, userId: scope.userId, alias: "m" })

  const createdCount = await queryScalarCount(
    input.turso,
    `SELECT COUNT(*) AS count
     FROM memories m
     WHERE ${memoryScope.clause}
       AND m.created_at >= ?`,
    [...memoryScope.args, windowStartIso]
  )

  const updatedCount = await queryScalarCount(
    input.turso,
    `SELECT COUNT(*) AS count
     FROM memories m
     WHERE ${memoryScope.clause}
       AND m.updated_at >= ?`,
    [...memoryScope.args, windowStartIso]
  )

  const deletedCount = await queryScalarCount(
    input.turso,
    `SELECT COUNT(*) AS count
     FROM memories m
     WHERE ${memoryScope.clause}
       AND m.deleted_at IS NOT NULL
       AND m.deleted_at >= ?`,
    [...memoryScope.args, windowStartIso]
  )

  const activeCount = await queryScalarCount(
    input.turso,
    `SELECT COUNT(*) AS count
     FROM memories m
     WHERE ${memoryScope.clause}
       AND m.deleted_at IS NULL`,
    [...memoryScope.args]
  )

  const totalCount = await queryScalarCount(
    input.turso,
    `SELECT COUNT(*) AS count
     FROM memories m
     WHERE ${memoryScope.clause}`,
    [...memoryScope.args]
  )

  const sessionScope = buildScopeFilter({ projectId: scope.projectId, userId: scope.userId, alias: "s" })
  const compactionResult = await input.turso.execute({
    sql: `SELECT
            COALESCE(e.trigger_type, 'count') AS trigger_type,
            COUNT(*) AS event_count,
            SUM(CASE WHEN e.checkpoint_memory_id IS NULL OR e.checkpoint_memory_id = '' THEN 1 ELSE 0 END) AS missing_count,
            COUNT(DISTINCT e.session_id) AS session_count
          FROM memory_compaction_events e
          LEFT JOIN memory_sessions s ON s.id = e.session_id
          WHERE e.created_at >= ?
            AND ${sessionScope.clause}
          GROUP BY e.trigger_type`,
    args: [windowStartIso, ...sessionScope.args],
  })

  const compactionByTrigger = { count: 0, time: 0, semantic: 0 }
  let compactionTotal = 0
  let compactedSessions = 0
  let checkpointMissingCount = 0
  for (const row of compactionResult.rows) {
    const trigger = String(row.trigger_type ?? "count")
    const eventCount = toCount(row.event_count)
    const missingCount = toCount(row.missing_count)
    const sessionCount = toCount(row.session_count)
    if (trigger === "count" || trigger === "time" || trigger === "semantic") {
      compactionByTrigger[trigger] = eventCount
    }
    compactionTotal += eventCount
    checkpointMissingCount += missingCount
    compactedSessions += sessionCount
  }

  const checkpointCoverage =
    compactionTotal > 0 ? roundMetric((compactionTotal - checkpointMissingCount) / compactionTotal) : 1

  const consolidationScope = buildScopeFilter({
    projectId: scope.projectId,
    userId: scope.userId,
    alias: "r",
  })
  const consolidationResult = await input.turso.execute({
    sql: `SELECT
            COUNT(*) AS run_count,
            SUM(merged_count) AS merged_count,
            SUM(superseded_count) AS superseded_count,
            SUM(conflicted_count) AS conflicted_count,
            MAX(created_at) AS last_run_at
          FROM memory_consolidation_runs r
          WHERE r.created_at >= ?
            AND ${consolidationScope.clause}`,
    args: [windowStartIso, ...consolidationScope.args],
  })
  const consolidationRow = consolidationResult.rows[0] ?? {}
  const consolidationRunCount = toCount((consolidationRow as { run_count?: unknown }).run_count)
  const mergedCount = toCount((consolidationRow as { merged_count?: unknown }).merged_count)
  const supersededCount = toCount((consolidationRow as { superseded_count?: unknown }).superseded_count)
  const conflictedCount = toCount((consolidationRow as { conflicted_count?: unknown }).conflicted_count)
  const conflictRate = consolidationRunCount > 0 ? roundMetric(conflictedCount / consolidationRunCount) : 0
  const lastRunAt =
    typeof (consolidationRow as { last_run_at?: unknown }).last_run_at === "string"
      ? String((consolidationRow as { last_run_at?: unknown }).last_run_at)
      : null

  let contradictionsTotalCount = 0
  let contradictionWindowCount = 0
  let contradictionDaily: Array<{ date: string; count: number }> = []
  if (await tableExists(input.turso, "memory_links")) {
    const contradictionScope = buildScopeFilter({
      projectId: scope.projectId,
      userId: scope.userId,
      alias: "m",
    })

    contradictionsTotalCount = await queryScalarCount(
      input.turso,
      `SELECT COUNT(*) AS count
       FROM memory_links l
       LEFT JOIN memories m ON m.id = l.source_id
       WHERE l.link_type = 'contradicts'
         AND ${contradictionScope.clause}`,
      [...contradictionScope.args]
    )

    contradictionWindowCount = await queryScalarCount(
      input.turso,
      `SELECT COUNT(*) AS count
       FROM memory_links l
       LEFT JOIN memories m ON m.id = l.source_id
       WHERE l.link_type = 'contradicts'
         AND l.created_at >= ?
         AND ${contradictionScope.clause}`,
      [windowStartIso, ...contradictionScope.args]
    )

    const dailyResult = await input.turso.execute({
      sql: `SELECT substr(l.created_at, 1, 10) AS day, COUNT(*) AS day_count
            FROM memory_links l
            LEFT JOIN memories m ON m.id = l.source_id
            WHERE l.link_type = 'contradicts'
              AND l.created_at >= ?
              AND ${contradictionScope.clause}
            GROUP BY day
            ORDER BY day ASC`,
      args: [windowStartIso, ...contradictionScope.args],
    })
    contradictionDaily = dailyResult.rows.map((row) => ({
      date: String(row.day ?? ""),
      count: toCount(row.day_count),
    }))
  }

  const contradictionTrend = computeTrend(contradictionDaily)

  const alarms: MemoryLifecycleObservabilityAlarm[] = []
  if (
    compactionTotal >= MEMORY_OBSERVABILITY_SLOS.checkpointCoverage.minSamples &&
    checkpointCoverage < MEMORY_OBSERVABILITY_SLOS.checkpointCoverage.warning
  ) {
    const critical = checkpointCoverage < MEMORY_OBSERVABILITY_SLOS.checkpointCoverage.critical
    alarms.push({
      code: "LOW_CHECKPOINT_COVERAGE",
      severity: critical ? "critical" : "warning",
      message: `Compaction checkpoint coverage is ${Math.round(checkpointCoverage * 100)}%`,
      observed: checkpointCoverage,
      threshold: critical
        ? MEMORY_OBSERVABILITY_SLOS.checkpointCoverage.critical
        : MEMORY_OBSERVABILITY_SLOS.checkpointCoverage.warning,
      unit: "ratio",
    })
  }

  if (
    consolidationRunCount >= MEMORY_OBSERVABILITY_SLOS.consolidationConflictRate.minSamples &&
    conflictRate >= MEMORY_OBSERVABILITY_SLOS.consolidationConflictRate.warning
  ) {
    const critical = conflictRate >= MEMORY_OBSERVABILITY_SLOS.consolidationConflictRate.critical
    alarms.push({
      code: "HIGH_CONSOLIDATION_CONFLICT_RATE",
      severity: critical ? "critical" : "warning",
      message: `Consolidation conflict rate is ${Math.round(conflictRate * 100)}%`,
      observed: conflictRate,
      threshold: critical
        ? MEMORY_OBSERVABILITY_SLOS.consolidationConflictRate.critical
        : MEMORY_OBSERVABILITY_SLOS.consolidationConflictRate.warning,
      unit: "ratio",
    })
  }

  if (contradictionWindowCount >= MEMORY_OBSERVABILITY_SLOS.contradictionWindowCount.warning) {
    const critical = contradictionWindowCount >= MEMORY_OBSERVABILITY_SLOS.contradictionWindowCount.critical
    alarms.push({
      code: "CONTRADICTION_TREND_VOLUME",
      severity: critical ? "critical" : "warning",
      message: `Contradiction links in window: ${contradictionWindowCount}`,
      observed: contradictionWindowCount,
      threshold: critical
        ? MEMORY_OBSERVABILITY_SLOS.contradictionWindowCount.critical
        : MEMORY_OBSERVABILITY_SLOS.contradictionWindowCount.warning,
      unit: "count",
    })
  }

  return {
    sampledAt: nowIso,
    windowHours,
    scope,
    lifecycle: {
      createdCount,
      updatedCount,
      deletedCount,
      activeCount,
      totalCount,
    },
    compaction: {
      totalEvents: compactionTotal,
      byTrigger: compactionByTrigger,
      compactedSessions,
      checkpointMissingCount,
      checkpointCoverage,
    },
    consolidation: {
      runCount: consolidationRunCount,
      mergedCount,
      supersededCount,
      conflictedCount,
      conflictRate,
      lastRunAt,
    },
    contradictions: {
      totalCount: contradictionsTotalCount,
      windowCount: contradictionWindowCount,
      trend: contradictionTrend,
      daily: contradictionDaily,
    },
    alarms,
    health: deriveHealth(alarms),
  }
}
