import { createAdminClient } from "@/lib/supabase/admin"
import { isTestEnvironment, getSupabaseUrl, hasServiceRoleKey } from "@/lib/env"

type SupabaseLikeClient = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => unknown
  }
}

interface OrgAuditEventInput {
  orgId: string
  actorUserId?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  targetLabel?: string | null
  metadata?: Record<string, unknown>
  client?: unknown
}

function hasServiceRoleConfig(): boolean {
  if (isTestEnvironment()) return false
  return Boolean(getSupabaseUrl() && hasServiceRoleKey())
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error")
  }
  return String(error)
}

async function insertOrgAuditEvent(
  client: SupabaseLikeClient,
  input: OrgAuditEventInput
): Promise<void> {
  const table = client.from("org_audit_logs")
  if (!table || typeof table.insert !== "function") {
    return
  }

  const result = await table.insert({
    org_id: input.orgId,
    actor_user_id: input.actorUserId ?? null,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    target_label: input.targetLabel ?? null,
    metadata: input.metadata ?? {},
  })
  const error =
    typeof result === "object" && result !== null && "error" in result
      ? ((result as { error?: { message?: string } | null }).error ?? null)
      : null

  if (error) {
    throw new Error(error.message ?? "Failed to insert org audit event")
  }
}

function isSupabaseLikeClient(value: unknown): value is SupabaseLikeClient {
  return (
    typeof value === "object" &&
    value !== null &&
    "from" in value &&
    typeof (value as { from?: unknown }).from === "function"
  )
}

export async function logOrgAuditEvent(input: OrgAuditEventInput): Promise<void> {
  const errors: string[] = []

  if (hasServiceRoleConfig()) {
    try {
      const admin = createAdminClient()
      await insertOrgAuditEvent(admin as unknown as SupabaseLikeClient, input)
      return
    } catch (error) {
      errors.push(asErrorMessage(error))
    }
  }

  if (isSupabaseLikeClient(input.client)) {
    try {
      await insertOrgAuditEvent(input.client, input)
      return
    } catch (error) {
      errors.push(asErrorMessage(error))
    }
  }

  if (errors.length > 0) {
    console.error("Org audit log write failed:", {
      orgId: input.orgId,
      action: input.action,
      errors,
    })
  }
}
