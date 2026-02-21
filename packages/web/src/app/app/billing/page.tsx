import React from "react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createTurso } from "@libsql/client"
import { BillingContent } from "./billing-content"
import { resolveWorkspaceContext, type WorkspacePlan } from "@/lib/workspace"
import { buildSdkTenantOwnerScopeKey, resolveSdkProjectBillingContext } from "@/lib/sdk-project-billing"

export const metadata = {
  title: "Billing & Usage",
}

interface UsageStats {
  totalMemories: number
  totalRules: number
  totalDecisions: number
  totalFacts: number
  projectCount: number
  lastSync: string | null
}

interface TenantRoutingStatus {
  isActive: boolean
  readyTenantCount: number
  totalTenantCount: number
  apiKeyConfigured: boolean
  apiKeyExpired: boolean
}

async function getUsageStats(tursoUrl: string, tursoToken: string): Promise<UsageStats> {
  try {
    const turso = createTurso({ url: tursoUrl, authToken: tursoToken })

    const [totalResult, byTypeResult, projectsResult, lastSyncResult] = await Promise.all([
      turso.execute("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL"),
      turso.execute(`
        SELECT type, COUNT(*) as count 
        FROM memories 
        WHERE deleted_at IS NULL 
        GROUP BY type
      `),
      turso.execute(`
        SELECT COUNT(DISTINCT project_id) as count 
        FROM memories 
        WHERE deleted_at IS NULL AND scope = 'project' AND project_id IS NOT NULL
      `),
      turso.execute(`
        SELECT MAX(updated_at) as last_sync 
        FROM memories
      `),
    ])

    const byType = Object.fromEntries(
      byTypeResult.rows.map(r => [r.type, Number(r.count)])
    )

    return {
      totalMemories: Number(totalResult.rows[0]?.count ?? 0),
      totalRules: byType.rule || 0,
      totalDecisions: byType.decision || 0,
      totalFacts: byType.fact || 0,
      projectCount: Number(projectsResult.rows[0]?.count ?? 0),
      lastSync: lastSyncResult.rows[0]?.last_sync as string | null,
    }
  } catch {
    return {
      totalMemories: 0,
      totalRules: 0,
      totalDecisions: 0,
      totalFacts: 0,
      projectCount: 0,
      lastSync: null,
    }
  }
}

async function getTenantRoutingStatus(userId: string): Promise<TenantRoutingStatus> {
  const admin = createAdminClient()
  try {
    const { data: userData, error: userError } = await admin
      .from("users")
      .select("mcp_api_key_hash, mcp_api_key_expires_at")
      .eq("id", userId)
      .single()

    if (userError || !userData?.mcp_api_key_hash) {
      return {
        isActive: false,
        readyTenantCount: 0,
        totalTenantCount: 0,
        apiKeyConfigured: false,
        apiKeyExpired: false,
      }
    }

    const apiKeyExpired =
      !userData.mcp_api_key_expires_at ||
      new Date(userData.mcp_api_key_expires_at).getTime() <= Date.now()
    const billing = await resolveSdkProjectBillingContext(admin, userId)
    const ownerScopeKey =
      billing?.ownerScopeKey ??
      buildSdkTenantOwnerScopeKey({
        ownerType: "user",
        ownerUserId: userId,
        orgId: null,
      })

    const [readyResult, totalResult] = await Promise.all([
      admin
        .from("sdk_tenant_databases")
        .select("*", { count: "exact", head: true })
        .eq("owner_scope_key", ownerScopeKey)
        .eq("status", "ready"),
      admin
        .from("sdk_tenant_databases")
        .select("*", { count: "exact", head: true })
        .eq("owner_scope_key", ownerScopeKey)
        .neq("status", "disabled"),
    ])

    const readyTenantCount = Number(readyResult.count ?? 0)
    const totalTenantCount = Number(totalResult.count ?? 0)

    return {
      isActive: !apiKeyExpired && readyTenantCount > 0,
      readyTenantCount,
      totalTenantCount,
      apiKeyConfigured: true,
      apiKeyExpired,
    }
  } catch {
    return {
      isActive: false,
      readyTenantCount: 0,
      totalTenantCount: 0,
      apiKeyConfigured: false,
      apiKeyExpired: false,
    }
  }
}

export default async function BillingPage(): Promise<React.JSX.Element | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const [workspace, profileResult, tenantRouting] = await Promise.all([
    resolveWorkspaceContext(supabase, user.id),
    supabase
      .from("users")
      .select("stripe_customer_id, created_at")
      .eq("id", user.id)
      .single(),
    getTenantRoutingStatus(user.id),
  ])
  const { data: profile } = profileResult

  const [orgStripeCustomerId, usage] = await Promise.all([
    workspace?.ownerType === "organization" && workspace.orgId
      ? supabase
          .from("organizations")
          .select("stripe_customer_id")
          .eq("id", workspace.orgId)
          .single()
          .then(({ data }) => data?.stripe_customer_id ?? null)
      : Promise.resolve<string | null>(null),
    workspace?.turso_db_url && workspace?.turso_db_token
      ? getUsageStats(workspace.turso_db_url, workspace.turso_db_token)
      : Promise.resolve<UsageStats>({
          totalMemories: 0,
          totalRules: 0,
          totalDecisions: 0,
          totalFacts: 0,
          projectCount: 0,
          lastSync: null,
        }),
  ])

  const plan: WorkspacePlan = workspace?.plan ?? "free"
  const hasStripeCustomer =
    workspace?.ownerType === "organization"
      ? Boolean(orgStripeCustomerId)
      : Boolean(profile?.stripe_customer_id)
  const memberSince = profile?.created_at

  return (
    <BillingContent 
      plan={plan}
      hasStripeCustomer={hasStripeCustomer}
      usage={usage}
      memberSince={memberSince}
      ownerType={workspace?.ownerType ?? "user"}
      orgRole={workspace?.orgRole ?? null}
      canManageBilling={workspace?.canManageBilling ?? true}
      tenantRouting={tenantRouting}
    />
  )
}
