import { createClient as createTurso } from "@libsql/client"
import { getGraphStatusPayload } from "@/lib/memory-service/graph/status"
import { resolveWorkspaceContext, type WorkspaceContext } from "@/lib/workspace"

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
  admin: unknown
  userId: string
  email: string
}

function parseError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function scalarCount(
  turso: ReturnType<typeof createTurso>,
  sql: string,
  args: Array<string | number> = []
): Promise<number> {
  const result = await turso.execute({ sql, args })
  return Number(result.rows[0]?.count ?? 0)
}

function isMissingDeletedAtColumnError(error: unknown): boolean {
  const message = parseError(error).toLowerCase()
  return message.includes("no such column") && message.includes("deleted_at")
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
