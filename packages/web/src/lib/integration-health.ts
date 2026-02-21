import { createClient as createTurso } from "@libsql/client"
import { getGraphStatusPayload } from "@/lib/memory-service/graph/status"
import { resolveWorkspaceContext, type WorkspaceContext } from "@/lib/workspace"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  WORKSPACE_SWITCH_BUDGETS,
  emptyWorkspaceSwitchHealth,
  evaluateWorkspaceSwitchPerformance,
  type WorkspaceSwitchHealth,
} from "@/lib/workspace-switch-performance"
import {
  WORKSPACE_SWITCH_PROFILE_BUDGETS,
  emptyWorkspaceSwitchProfiling,
  evaluateWorkspaceSwitchProfiling,
  type WorkspaceSwitchProfilingHealth,
} from "@/lib/workspace-switch-profiling"
import { isMissingDeletedAtColumnError } from "@/lib/sqlite-errors"

type WorkspaceSwitchHealthWithProfiling = WorkspaceSwitchHealth & {
  profiling: WorkspaceSwitchProfilingHealth
}

export interface IntegrationHealthPayload {
  status: "ok" | "degraded" | "error"
  sampledAt: string
  auth: {
    ok: boolean
    userId: string
    email: string
  }
  workspace: {
    ok: boolean
    label: string
    ownerType: WorkspaceContext["ownerType"] | null
    orgId: string | null
    orgRole: WorkspaceContext["orgRole"] | null
    plan: WorkspaceContext["plan"] | null
    hasDatabase: boolean
    canProvision: boolean
  }
  workspaceSwitch: WorkspaceSwitchHealthWithProfiling
  database: {
    ok: boolean
    latencyMs: number | null
    memoriesCount: number | null
    error: string | null
  }
  graph: {
    ok: boolean
    health: "ok" | "schema_missing" | "unavailable"
    nodes: number
    edges: number
    memoryLinks: number
    rolloutMode: "off" | "shadow" | "canary" | null
    fallbackRate24h: number | null
  }
  issues: string[]
}

interface BuildIntegrationHealthInput {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  email: string
}

interface WorkspaceSwitchEventRow {
  duration_ms: number | null
  success: boolean | null
  created_at: string | null
}

interface WorkspaceSwitchProfileEventRow {
  success: boolean | null
  created_at: string | null
  client_total_ms: number | null
  user_patch_ms: number | null
  workspace_prefetch_ms: number | null
  integration_health_prefetch_ms: number | null
  workspace_summary_total_ms: number | null
  workspace_summary_query_ms: number | null
  workspace_summary_org_count: number | null
  workspace_summary_workspace_count: number | null
  workspace_summary_response_bytes: number | null
}

function parseError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error")
  }
  return String(error)
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  const message = parseError(error).toLowerCase()
  return (
    message.includes(tableName.toLowerCase()) &&
    (message.includes("does not exist") || message.includes("could not find the table"))
  )
}

function isMissingWorkspaceSwitchTableError(error: unknown): boolean {
  return isMissingTableError(error, "workspace_switch_events")
}

function isMissingWorkspaceSwitchProfileTableError(error: unknown): boolean {
  return isMissingTableError(error, "workspace_switch_profile_events")
}

function toNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) return null
  if (value < 0) return null
  return value
}

async function scalarCount(
  turso: ReturnType<typeof createTurso>,
  sql: string,
  args: Array<string | number> = []
): Promise<number> {
  const result = await turso.execute({ sql, args })
  return Number(result.rows[0]?.count ?? 0)
}

async function countMemories(turso: ReturnType<typeof createTurso>): Promise<number> {
  try {
    return await scalarCount(turso, "SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL")
  } catch (error) {
    if (!isMissingDeletedAtColumnError(error)) {
      throw error
    }
  }

  return scalarCount(turso, "SELECT COUNT(*) as count FROM memories")
}

function workspaceLabel(workspace: WorkspaceContext): string {
  if (workspace.ownerType === "user") return "personal"
  if (workspace.orgId) return `org:${workspace.orgId}`
  return "organization"
}

async function loadWorkspaceSwitchHealth(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  sampledAt: string
): Promise<WorkspaceSwitchHealth> {
  const since = new Date(
    Date.parse(sampledAt) - WORKSPACE_SWITCH_BUDGETS.windowHours * 60 * 60 * 1000
  ).toISOString()

  const { data, error } = await admin
    .from("workspace_switch_events")
    .select("duration_ms, success, created_at")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) {
    if (isMissingWorkspaceSwitchTableError(error)) {
      return emptyWorkspaceSwitchHealth(
        "unavailable",
        "workspace switch telemetry table is missing (run latest migration)",
        { windowHours: WORKSPACE_SWITCH_BUDGETS.windowHours }
      )
    }
    return emptyWorkspaceSwitchHealth("unavailable", parseError(error), {
      windowHours: WORKSPACE_SWITCH_BUDGETS.windowHours,
    })
  }

  const rows = (data ?? []) as WorkspaceSwitchEventRow[]
  const events = rows
    .map((row) => ({
      durationMs: Number(row.duration_ms ?? 0),
      success: Boolean(row.success),
      createdAt: row.created_at ?? sampledAt,
    }))
    .filter((event) => Number.isFinite(event.durationMs) && event.durationMs >= 0)

  return evaluateWorkspaceSwitchPerformance(events, {
    nowIso: sampledAt,
    windowHours: WORKSPACE_SWITCH_BUDGETS.windowHours,
    minSamples: WORKSPACE_SWITCH_BUDGETS.minSamples,
    p50BudgetMs: WORKSPACE_SWITCH_BUDGETS.p50Ms,
    p95BudgetMs: WORKSPACE_SWITCH_BUDGETS.p95Ms,
  })
}

async function loadWorkspaceSwitchProfiling(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  sampledAt: string,
): Promise<WorkspaceSwitchProfilingHealth> {
  const since = new Date(
    Date.parse(sampledAt) - WORKSPACE_SWITCH_PROFILE_BUDGETS.windowHours * 60 * 60 * 1000,
  ).toISOString()

  const { data, error } = await admin
    .from("workspace_switch_profile_events")
    .select(
      "success, created_at, client_total_ms, user_patch_ms, workspace_prefetch_ms, integration_health_prefetch_ms, workspace_summary_total_ms, workspace_summary_query_ms, workspace_summary_org_count, workspace_summary_workspace_count, workspace_summary_response_bytes",
    )
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000)

  if (error) {
    if (isMissingWorkspaceSwitchProfileTableError(error)) {
      return emptyWorkspaceSwitchProfiling(
        "unavailable",
        "workspace switch profiling table is missing (run latest migration)",
      )
    }
    return emptyWorkspaceSwitchProfiling("unavailable", parseError(error))
  }

  const rows = (data ?? []) as WorkspaceSwitchProfileEventRow[]
  const events = rows.map((row) => ({
    success: Boolean(row.success),
    createdAt: row.created_at ?? sampledAt,
    clientTotalMs: toNullableNumber(row.client_total_ms),
    userPatchMs: toNullableNumber(row.user_patch_ms),
    workspacePrefetchMs: toNullableNumber(row.workspace_prefetch_ms),
    integrationHealthPrefetchMs: toNullableNumber(row.integration_health_prefetch_ms),
    workspaceSummaryTotalMs: toNullableNumber(row.workspace_summary_total_ms),
    workspaceSummaryQueryMs: toNullableNumber(row.workspace_summary_query_ms),
    workspaceSummaryOrgCount: toNullableNumber(row.workspace_summary_org_count),
    workspaceSummaryWorkspaceCount: toNullableNumber(row.workspace_summary_workspace_count),
    workspaceSummaryResponseBytes: toNullableNumber(row.workspace_summary_response_bytes),
  }))

  return evaluateWorkspaceSwitchProfiling(events, {
    minSamples: WORKSPACE_SWITCH_PROFILE_BUDGETS.minSamples,
    p95ClientTotalBudgetMs: WORKSPACE_SWITCH_PROFILE_BUDGETS.p95ClientTotalMs,
    p95LargeTenantClientTotalBudgetMs: WORKSPACE_SWITCH_PROFILE_BUDGETS.p95LargeTenantClientTotalMs,
    p95SummaryTotalBudgetMs: WORKSPACE_SWITCH_PROFILE_BUDGETS.p95SummaryTotalMs,
    p95SummaryQueryBudgetMs: WORKSPACE_SWITCH_PROFILE_BUDGETS.p95SummaryQueryMs,
    largeTenantOrgCount: WORKSPACE_SWITCH_PROFILE_BUDGETS.largeTenantOrgCount,
    largeTenantResponseBytes: WORKSPACE_SWITCH_PROFILE_BUDGETS.largeTenantResponseBytes,
  })
}

export async function buildIntegrationHealthPayload(
  input: BuildIntegrationHealthInput
): Promise<IntegrationHealthPayload> {
  const sampledAt = new Date().toISOString()
  const issues: string[] = []

  const workspace = await resolveWorkspaceContext(input.admin, input.userId)
  if (!workspace) {
    return {
      status: "error",
      sampledAt,
      auth: {
        ok: true,
        userId: input.userId,
        email: input.email,
      },
      workspace: {
        ok: false,
        label: "unknown",
        ownerType: null,
        orgId: null,
        orgRole: null,
        plan: null,
        hasDatabase: false,
        canProvision: false,
      },
      workspaceSwitch: {
        ...emptyWorkspaceSwitchHealth("unavailable", "workspace context unavailable"),
        profiling: emptyWorkspaceSwitchProfiling("unavailable", "workspace context unavailable"),
      },
      database: {
        ok: false,
        latencyMs: null,
        memoriesCount: null,
        error: "Workspace could not be resolved for this user.",
      },
      graph: {
        ok: false,
        health: "unavailable",
        nodes: 0,
        edges: 0,
        memoryLinks: 0,
        rolloutMode: null,
        fallbackRate24h: null,
      },
      issues: ["Workspace context is missing or inaccessible."],
    }
  }

  const payload: IntegrationHealthPayload = {
    status: "ok",
    sampledAt,
    auth: {
      ok: true,
      userId: input.userId,
      email: input.email,
    },
    workspace: {
      ok: true,
      label: workspaceLabel(workspace),
      ownerType: workspace.ownerType,
      orgId: workspace.orgId,
      orgRole: workspace.orgRole,
      plan: workspace.plan,
      hasDatabase: workspace.hasDatabase,
      canProvision: workspace.canProvision,
    },
    workspaceSwitch: {
      ...emptyWorkspaceSwitchHealth("unavailable", null),
      profiling: emptyWorkspaceSwitchProfiling("unavailable", null),
    },
    database: {
      ok: false,
      latencyMs: null,
      memoriesCount: null,
      error: null,
    },
    graph: {
      ok: false,
      health: "unavailable",
      nodes: 0,
      edges: 0,
      memoryLinks: 0,
      rolloutMode: null,
      fallbackRate24h: null,
    },
    issues,
  }

  const [workspaceSwitchResult, workspaceSwitchProfilingResult] = await Promise.allSettled([
    loadWorkspaceSwitchHealth(input.admin, input.userId, sampledAt),
    loadWorkspaceSwitchProfiling(input.admin, input.userId, sampledAt),
  ])

  const workspaceSwitchHealth =
    workspaceSwitchResult.status === "fulfilled"
      ? workspaceSwitchResult.value
      : emptyWorkspaceSwitchHealth("unavailable", parseError(workspaceSwitchResult.reason))
  const workspaceSwitchProfiling =
    workspaceSwitchProfilingResult.status === "fulfilled"
      ? workspaceSwitchProfilingResult.value
      : emptyWorkspaceSwitchProfiling(
          "unavailable",
          parseError(workspaceSwitchProfilingResult.reason),
        )

  payload.workspaceSwitch = {
    ...workspaceSwitchHealth,
    profiling: workspaceSwitchProfiling,
  }

  if (workspaceSwitchHealth.status === "degraded") {
    for (const alarm of workspaceSwitchHealth.alarms) {
      issues.push(alarm.message)
    }
  } else if (workspaceSwitchHealth.status === "unavailable" && workspaceSwitchHealth.error) {
    issues.push(`Workspace switch telemetry unavailable: ${workspaceSwitchHealth.error}`)
  }

  if (workspaceSwitchProfiling.status === "warn") {
    for (const warning of workspaceSwitchProfiling.warnings) {
      issues.push(warning)
    }
  } else if (workspaceSwitchProfiling.status === "unavailable" && workspaceSwitchProfiling.error) {
    issues.push(`Workspace switch profiling unavailable: ${workspaceSwitchProfiling.error}`)
  }

  if (!workspace.hasDatabase || !workspace.turso_db_url || !workspace.turso_db_token) {
    issues.push("Workspace database is not provisioned.")
    payload.database.error = "No Turso credentials configured for the active workspace."
    payload.status = "degraded"
    return payload
  }

  const turso = createTurso({
    url: workspace.turso_db_url,
    authToken: workspace.turso_db_token,
  })

  try {
    const startedAt = Date.now()
    await turso.execute("SELECT 1 as ok")
    payload.database.latencyMs = Date.now() - startedAt
    payload.database.memoriesCount = await countMemories(turso)
    payload.database.ok = true
  } catch (error) {
    payload.database.error = parseError(error)
    issues.push(`Workspace database check failed: ${payload.database.error}`)
    payload.status = "error"
    return payload
  }

  try {
    const graphStatus = await getGraphStatusPayload({
      turso,
      nowIso: sampledAt,
      topNodesLimit: 5,
      syncMappings: false,
    })
    payload.graph = {
      ok: graphStatus.health === "ok",
      health: graphStatus.health,
      nodes: graphStatus.counts.nodes,
      edges: graphStatus.counts.edges,
      memoryLinks: graphStatus.counts.memoryLinks,
      rolloutMode: graphStatus.rollout.mode,
      fallbackRate24h: graphStatus.shadowMetrics.fallbackRate,
    }

    if (graphStatus.health !== "ok") {
      issues.push("Graph schema is missing for this workspace.")
    } else if (
      (payload.database.memoriesCount ?? 0) > 0 &&
      graphStatus.counts.nodes === 0 &&
      graphStatus.counts.memoryLinks === 0
    ) {
      issues.push("Memories exist but graph mappings are empty.")
    }
  } catch (error) {
    payload.graph = {
      ok: false,
      health: "unavailable",
      nodes: 0,
      edges: 0,
      memoryLinks: 0,
      rolloutMode: null,
      fallbackRate24h: null,
    }
    issues.push(`Graph status unavailable: ${parseError(error)}`)
  }

  if (payload.status !== "error" && issues.length > 0) {
    payload.status = "degraded"
  }

  return payload
}
