import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { BillingContent } from "./billing-content"
import { resolveWorkspaceContext } from "@/lib/workspace"

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
        SELECT COUNT(DISTINCT scope) as count 
        FROM memories 
        WHERE deleted_at IS NULL AND scope != 'global'
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

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const workspace = await resolveWorkspaceContext(supabase, user.id)

  const { data: profile } = await supabase
    .from("users")
    .select("stripe_customer_id, created_at")
    .eq("id", user.id)
    .single()

  const plan = workspace?.plan || "free"
  const hasStripeCustomer = !!profile?.stripe_customer_id
  const memberSince = profile?.created_at

  let usage: UsageStats = {
    totalMemories: 0,
    totalRules: 0,
    totalDecisions: 0,
    totalFacts: 0,
    projectCount: 0,
    lastSync: null,
  }

  if (workspace?.turso_db_url && workspace?.turso_db_token) {
    usage = await getUsageStats(workspace.turso_db_url, workspace.turso_db_token)
  }

  return (
    <BillingContent 
      plan={plan}
      hasStripeCustomer={hasStripeCustomer}
      usage={usage}
      memberSince={memberSince}
      ownerType={workspace?.ownerType ?? "user"}
      orgRole={workspace?.orgRole ?? null}
      canManageBilling={workspace?.canManageBilling ?? true}
    />
  )
}
