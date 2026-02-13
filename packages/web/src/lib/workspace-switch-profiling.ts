export const WORKSPACE_SWITCH_PROFILE_BUDGETS = {
  windowHours: 24,
  minSamples: 5,
  p95ClientTotalMs: 1600,
  p95LargeTenantClientTotalMs: 2200,
  p95SummaryTotalMs: 900,
  p95SummaryQueryMs: 500,
  largeTenantOrgCount: 10,
  largeTenantResponseBytes: 80_000,
} as const

export type WorkspaceSwitchProfilingStatus = "ok" | "warn" | "insufficient_data" | "unavailable"

export interface WorkspaceSwitchProfileEvent {
  success: boolean
  createdAt: string
  clientTotalMs: number | null
  userPatchMs: number | null
  workspacePrefetchMs: number | null
  integrationHealthPrefetchMs: number | null
  workspaceSummaryTotalMs: number | null
  workspaceSummaryQueryMs: number | null
  workspaceSummaryOrgCount: number | null
  workspaceSummaryWorkspaceCount: number | null
  workspaceSummaryResponseBytes: number | null
}

export interface WorkspaceSwitchProfilingHealth {
  status: WorkspaceSwitchProfilingStatus
  sampleCount: number
  successfulSampleCount: number
  profiledSampleCount: number
  largeTenantThresholds: {
    orgCount: number
    responseBytes: number
  }
  largeTenantSampleCount: number
  p95ClientTotalMs: number | null
  p95LargeTenantClientTotalMs: number | null
  phaseP95Ms: {
    userPatchMs: number | null
    workspacePrefetchMs: number | null
    integrationHealthPrefetchMs: number | null
    workspaceSummaryTotalMs: number | null
    workspaceSummaryQueryMs: number | null
  }
  warnings: string[]
  error: string | null
}

export interface WorkspaceSwitchProfilingOptions {
  minSamples?: number
  p95ClientTotalBudgetMs?: number
  p95LargeTenantClientTotalBudgetMs?: number
  p95SummaryTotalBudgetMs?: number
  p95SummaryQueryBudgetMs?: number
  largeTenantOrgCount?: number
  largeTenantResponseBytes?: number
}

function toFiniteNonNegative(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) return null
  if (value < 0) return null
  return value
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index] ?? null
}

function collectMetric(
  events: WorkspaceSwitchProfileEvent[],
  pick: (event: WorkspaceSwitchProfileEvent) => number | null,
): number[] {
  return events
    .map((event) => toFiniteNonNegative(pick(event)))
    .filter((value): value is number => value !== null)
}

export function emptyWorkspaceSwitchProfiling(
  status: WorkspaceSwitchProfilingStatus,
  error: string | null,
): WorkspaceSwitchProfilingHealth {
  return {
    status,
    sampleCount: 0,
    successfulSampleCount: 0,
    profiledSampleCount: 0,
    largeTenantThresholds: {
      orgCount: WORKSPACE_SWITCH_PROFILE_BUDGETS.largeTenantOrgCount,
      responseBytes: WORKSPACE_SWITCH_PROFILE_BUDGETS.largeTenantResponseBytes,
    },
    largeTenantSampleCount: 0,
    p95ClientTotalMs: null,
    p95LargeTenantClientTotalMs: null,
    phaseP95Ms: {
      userPatchMs: null,
      workspacePrefetchMs: null,
      integrationHealthPrefetchMs: null,
      workspaceSummaryTotalMs: null,
      workspaceSummaryQueryMs: null,
    },
    warnings: [],
    error,
  }
}

export function evaluateWorkspaceSwitchProfiling(
  events: WorkspaceSwitchProfileEvent[],
  options: WorkspaceSwitchProfilingOptions = {},
): WorkspaceSwitchProfilingHealth {
  const minSamples = options.minSamples ?? WORKSPACE_SWITCH_PROFILE_BUDGETS.minSamples
  const p95ClientTotalBudgetMs =
    options.p95ClientTotalBudgetMs ?? WORKSPACE_SWITCH_PROFILE_BUDGETS.p95ClientTotalMs
  const p95LargeTenantClientTotalBudgetMs =
    options.p95LargeTenantClientTotalBudgetMs ??
    WORKSPACE_SWITCH_PROFILE_BUDGETS.p95LargeTenantClientTotalMs
  const p95SummaryTotalBudgetMs =
    options.p95SummaryTotalBudgetMs ?? WORKSPACE_SWITCH_PROFILE_BUDGETS.p95SummaryTotalMs
  const p95SummaryQueryBudgetMs =
    options.p95SummaryQueryBudgetMs ?? WORKSPACE_SWITCH_PROFILE_BUDGETS.p95SummaryQueryMs
  const largeTenantOrgCount =
    options.largeTenantOrgCount ?? WORKSPACE_SWITCH_PROFILE_BUDGETS.largeTenantOrgCount
  const largeTenantResponseBytes =
    options.largeTenantResponseBytes ?? WORKSPACE_SWITCH_PROFILE_BUDGETS.largeTenantResponseBytes

  const successful = events.filter((event) => event.success)
  const profiled = successful.filter((event) => toFiniteNonNegative(event.clientTotalMs) !== null)
  const largeTenantProfiled = profiled.filter((event) => {
    const orgCount = toFiniteNonNegative(event.workspaceSummaryOrgCount) ?? 0
    const responseBytes = toFiniteNonNegative(event.workspaceSummaryResponseBytes) ?? 0
    return orgCount >= largeTenantOrgCount || responseBytes >= largeTenantResponseBytes
  })

  const p95ClientTotalMs = percentile(collectMetric(profiled, (event) => event.clientTotalMs), 95)
  const p95LargeTenantClientTotalMs = percentile(
    collectMetric(largeTenantProfiled, (event) => event.clientTotalMs),
    95,
  )

  const phaseP95Ms = {
    userPatchMs: percentile(collectMetric(profiled, (event) => event.userPatchMs), 95),
    workspacePrefetchMs: percentile(collectMetric(profiled, (event) => event.workspacePrefetchMs), 95),
    integrationHealthPrefetchMs: percentile(
      collectMetric(profiled, (event) => event.integrationHealthPrefetchMs),
      95,
    ),
    workspaceSummaryTotalMs: percentile(
      collectMetric(profiled, (event) => event.workspaceSummaryTotalMs),
      95,
    ),
    workspaceSummaryQueryMs: percentile(
      collectMetric(profiled, (event) => event.workspaceSummaryQueryMs),
      95,
    ),
  }

  const warnings: string[] = []

  if (profiled.length >= minSamples && p95ClientTotalMs !== null && p95ClientTotalMs > p95ClientTotalBudgetMs) {
    warnings.push(
      `Workspace switch client p95 ${p95ClientTotalMs}ms exceeds profiling budget ${p95ClientTotalBudgetMs}ms.`,
    )
  }

  if (
    largeTenantProfiled.length >= minSamples &&
    p95LargeTenantClientTotalMs !== null &&
    p95LargeTenantClientTotalMs > p95LargeTenantClientTotalBudgetMs
  ) {
    warnings.push(
      `Large-tenant workspace switch client p95 ${p95LargeTenantClientTotalMs}ms exceeds budget ${p95LargeTenantClientTotalBudgetMs}ms.`,
    )
  }

  if (
    profiled.length >= minSamples &&
    phaseP95Ms.workspaceSummaryTotalMs !== null &&
    phaseP95Ms.workspaceSummaryTotalMs > p95SummaryTotalBudgetMs
  ) {
    warnings.push(
      `Workspace summaries total p95 ${phaseP95Ms.workspaceSummaryTotalMs}ms exceeds budget ${p95SummaryTotalBudgetMs}ms.`,
    )
  }

  if (
    profiled.length >= minSamples &&
    phaseP95Ms.workspaceSummaryQueryMs !== null &&
    phaseP95Ms.workspaceSummaryQueryMs > p95SummaryQueryBudgetMs
  ) {
    warnings.push(
      `Workspace summary query p95 ${phaseP95Ms.workspaceSummaryQueryMs}ms exceeds budget ${p95SummaryQueryBudgetMs}ms.`,
    )
  }

  const status: WorkspaceSwitchProfilingStatus =
    profiled.length < minSamples ? "insufficient_data" : warnings.length > 0 ? "warn" : "ok"

  return {
    status,
    sampleCount: events.length,
    successfulSampleCount: successful.length,
    profiledSampleCount: profiled.length,
    largeTenantThresholds: {
      orgCount: largeTenantOrgCount,
      responseBytes: largeTenantResponseBytes,
    },
    largeTenantSampleCount: largeTenantProfiled.length,
    p95ClientTotalMs,
    p95LargeTenantClientTotalMs,
    phaseP95Ms,
    warnings,
    error: null,
  }
}
