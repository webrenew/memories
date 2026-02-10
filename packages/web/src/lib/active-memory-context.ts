interface UserMemoryRow {
  id: string
  current_org_id: string | null
  plan: string | null
  turso_db_url: string | null
  turso_db_token: string | null
  turso_db_name: string | null
}

type OrgSubscriptionStatus = "active" | "past_due" | "cancelled" | null

interface OrganizationMemoryRow {
  id: string
  plan: string | null
  subscription_status: OrgSubscriptionStatus
  stripe_subscription_id: string | null
  turso_db_url: string | null
  turso_db_token: string | null
  turso_db_name: string | null
}

interface OrgMembershipRow {
  role: "owner" | "admin" | "member"
}

export interface ActiveMemoryContext {
  ownerType: "user" | "organization"
  userId: string
  orgId: string | null
  orgRole: OrgMembershipRow["role"] | null
  plan: string | null
  turso_db_url: string | null
  turso_db_token: string | null
  turso_db_name: string | null
}

export interface ResolveActiveMemoryContextOptions {
  // If false, keeps organization context even when organization credentials are missing.
  fallbackToUserWithoutOrgCredentials?: boolean
}

function toUserContext(user: UserMemoryRow): ActiveMemoryContext {
  return {
    ownerType: "user",
    userId: user.id,
    orgId: null,
    orgRole: null,
    plan: user.plan,
    turso_db_url: user.turso_db_url,
    turso_db_token: user.turso_db_token,
    turso_db_name: user.turso_db_name,
  }
}

function resolveOrganizationPlan(
  org: OrganizationMemoryRow,
  fallbackPlan: string | null
): string | null {
  if (org.subscription_status === "past_due") {
    return "past_due"
  }

  if (org.subscription_status === "cancelled") {
    return "free"
  }

  // Active subscription with a Stripe subscription ID is definitively pro
  if (org.subscription_status === "active" && org.stripe_subscription_id) {
    return "pro"
  }

  // Org plan "team" or "enterprise" with active status is a paid tier,
  // even without a dedicated stripe_subscription_id (e.g. owner's personal sub covers it)
  if (
    org.subscription_status === "active" &&
    (org.plan === "team" || org.plan === "enterprise")
  ) {
    return "pro"
  }

  return org.plan ?? fallbackPlan
}

export async function resolveActiveMemoryContext(
  client: unknown,
  userId: string,
  options: ResolveActiveMemoryContextOptions = {}
): Promise<ActiveMemoryContext | null> {
  const supabase = client as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            single: () => Promise<{ data: unknown; error: unknown }>
          }
          single: () => Promise<{ data: unknown; error: unknown }>
        }
      }
    }
  }

  const fallbackToUserWithoutOrgCredentials =
    options.fallbackToUserWithoutOrgCredentials ?? false

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("id, current_org_id, plan, turso_db_url, turso_db_token, turso_db_name")
    .eq("id", userId)
    .single()

  if (userError || !userData) {
    return null
  }

  const user = userData as UserMemoryRow
  const userContext = toUserContext(user)

  if (!user.current_org_id) {
    return userContext
  }

  const { data: membershipData, error: membershipError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", user.current_org_id)
    .eq("user_id", userId)
    .single()

  if (membershipError || !membershipData) {
    return userContext
  }

  const { data: orgData, error: orgError } = await supabase
    .from("organizations")
    .select(
      "id, plan, subscription_status, stripe_subscription_id, turso_db_url, turso_db_token, turso_db_name"
    )
    .eq("id", user.current_org_id)
    .single()

  if (orgError || !orgData) {
    return userContext
  }

  const org = orgData as OrganizationMemoryRow
  const membership = membershipData as OrgMembershipRow
  const hasOrgCredentials = Boolean(org.turso_db_url && org.turso_db_token)

  if (!hasOrgCredentials && fallbackToUserWithoutOrgCredentials) {
    return userContext
  }

  return {
    ownerType: "organization",
    userId,
    orgId: org.id,
    orgRole: membership.role,
    plan: resolveOrganizationPlan(org, user.plan),
    turso_db_url: org.turso_db_url,
    turso_db_token: org.turso_db_token,
    turso_db_name: org.turso_db_name,
  }
}
