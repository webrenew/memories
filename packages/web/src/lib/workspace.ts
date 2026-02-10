import {
  resolveActiveMemoryContext,
  type ActiveMemoryContext,
  type ResolveActiveMemoryContextOptions,
} from "@/lib/active-memory-context"

export type WorkspacePlan = "free" | "pro" | "past_due"

export interface WorkspaceContext extends Omit<ActiveMemoryContext, "plan"> {
  plan: WorkspacePlan
  hasDatabase: boolean
  canProvision: boolean
  canManageBilling: boolean
}

export function normalizeWorkspacePlan(plan: string | null | undefined): WorkspacePlan {
  if (plan === "pro" || plan === "past_due") {
    return plan
  }
  return "free"
}

export function canProvisionWorkspace(
  ownerType: ActiveMemoryContext["ownerType"],
  orgRole: ActiveMemoryContext["orgRole"]
): boolean {
  if (ownerType === "user") {
    return true
  }
  return orgRole === "owner" || orgRole === "admin"
}

export function canManageWorkspaceBilling(
  ownerType: ActiveMemoryContext["ownerType"],
  orgRole: ActiveMemoryContext["orgRole"]
): boolean {
  if (ownerType === "user") {
    return true
  }
  return orgRole === "owner"
}

export async function resolveWorkspaceContext(
  client: unknown,
  userId: string,
  options: ResolveActiveMemoryContextOptions = {}
): Promise<WorkspaceContext | null> {
  const context = await resolveActiveMemoryContext(client, userId, options)
  if (!context) {
    return null
  }

  return {
    ...context,
    plan: normalizeWorkspacePlan(context.plan),
    hasDatabase: Boolean(context.turso_db_url && context.turso_db_token),
    canProvision: canProvisionWorkspace(context.ownerType, context.orgRole),
    canManageBilling: canManageWorkspaceBilling(context.ownerType, context.orgRole),
  }
}
