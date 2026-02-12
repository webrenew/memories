export const WORKSPACE_SWITCH_BUDGETS = {
  windowHours: 24,
  minSamples: 10,
  p50Ms: 400,
  p95Ms: 1000,
} as const

export type WorkspaceSwitchAlarmCode =
  | "WORKSPACE_SWITCH_P50_BUDGET_EXCEEDED"
  | "WORKSPACE_SWITCH_P95_BUDGET_EXCEEDED"

export interface WorkspaceSwitchAlarm {
  code: WorkspaceSwitchAlarmCode
  severity: "warn" | "critical"
  message: string
  triggeredAt: string
}

export type WorkspaceSwitchHealthStatus = "ok" | "degraded" | "insufficient_data" | "unavailable"

export interface WorkspaceSwitchEvent {
  durationMs: number
  success: boolean
  createdAt: string
}

export interface WorkspaceSwitchHealth {
  ok: boolean
  status: WorkspaceSwitchHealthStatus
  windowHours: number
  sampleCount: number
  successCount: number
  failureCount: number
  p50Ms: number | null
  p95Ms: number | null
  budgets: {
    minSamples: number
    p50Ms: number
    p95Ms: number
  }
  lastSwitchedAt: string | null
  lastErrorAt: string | null
  alarms: WorkspaceSwitchAlarm[]
  error: string | null
}

export interface WorkspaceSwitchEvaluationOptions {
  nowIso?: string
  windowHours?: number
  minSamples?: number
  p50BudgetMs?: number
  p95BudgetMs?: number
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const rank = Math.ceil((p / 100) * values.length)
  const index = Math.min(values.length - 1, Math.max(0, rank - 1))
  return values[index] ?? null
}

function newestTimestamp(values: string[]): string | null {
  if (values.length === 0) return null
  return values.reduce((latest, candidate) =>
    Date.parse(candidate) > Date.parse(latest) ? candidate : latest
  )
}

export function emptyWorkspaceSwitchHealth(
  status: WorkspaceSwitchHealthStatus,
  error: string | null,
  options: WorkspaceSwitchEvaluationOptions = {}
): WorkspaceSwitchHealth {
  return {
    ok: status !== "degraded" && status !== "unavailable",
    status,
    windowHours: options.windowHours ?? WORKSPACE_SWITCH_BUDGETS.windowHours,
    sampleCount: 0,
    successCount: 0,
    failureCount: 0,
    p50Ms: null,
    p95Ms: null,
    budgets: {
      minSamples: options.minSamples ?? WORKSPACE_SWITCH_BUDGETS.minSamples,
      p50Ms: options.p50BudgetMs ?? WORKSPACE_SWITCH_BUDGETS.p50Ms,
      p95Ms: options.p95BudgetMs ?? WORKSPACE_SWITCH_BUDGETS.p95Ms,
    },
    lastSwitchedAt: null,
    lastErrorAt: null,
    alarms: [],
    error,
  }
}

export function evaluateWorkspaceSwitchPerformance(
  events: WorkspaceSwitchEvent[],
  options: WorkspaceSwitchEvaluationOptions = {}
): WorkspaceSwitchHealth {
  const nowIso = options.nowIso ?? new Date().toISOString()
  const windowHours = options.windowHours ?? WORKSPACE_SWITCH_BUDGETS.windowHours
  const minSamples = options.minSamples ?? WORKSPACE_SWITCH_BUDGETS.minSamples
  const p50BudgetMs = options.p50BudgetMs ?? WORKSPACE_SWITCH_BUDGETS.p50Ms
  const p95BudgetMs = options.p95BudgetMs ?? WORKSPACE_SWITCH_BUDGETS.p95Ms

  const successful = events
    .filter((event) => event.success)
    .map((event) => event.durationMs)
    .filter((duration) => Number.isFinite(duration) && duration >= 0)
    .sort((a, b) => a - b)

  const failed = events.filter((event) => !event.success)

  const p50Ms = percentile(successful, 50)
  const p95Ms = percentile(successful, 95)

  const alarms: WorkspaceSwitchAlarm[] = []

  if (successful.length >= minSamples && p50Ms !== null && p50Ms > p50BudgetMs) {
    alarms.push({
      code: "WORKSPACE_SWITCH_P50_BUDGET_EXCEEDED",
      severity: "warn",
      message: `Workspace switch p50 ${p50Ms}ms exceeds budget ${p50BudgetMs}ms over ${windowHours}h window.`,
      triggeredAt: nowIso,
    })
  }

  if (successful.length >= minSamples && p95Ms !== null && p95Ms > p95BudgetMs) {
    alarms.push({
      code: "WORKSPACE_SWITCH_P95_BUDGET_EXCEEDED",
      severity: "critical",
      message: `Workspace switch p95 ${p95Ms}ms exceeds budget ${p95BudgetMs}ms over ${windowHours}h window.`,
      triggeredAt: nowIso,
    })
  }

  const status: WorkspaceSwitchHealthStatus =
    successful.length < minSamples
      ? "insufficient_data"
      : alarms.length > 0
        ? "degraded"
        : "ok"

  return {
    ok: status !== "degraded",
    status,
    windowHours,
    sampleCount: events.length,
    successCount: successful.length,
    failureCount: failed.length,
    p50Ms,
    p95Ms,
    budgets: {
      minSamples,
      p50Ms: p50BudgetMs,
      p95Ms: p95BudgetMs,
    },
    lastSwitchedAt: newestTimestamp(events.map((event) => event.createdAt)),
    lastErrorAt: newestTimestamp(failed.map((event) => event.createdAt)),
    alarms,
    error: null,
  }
}
