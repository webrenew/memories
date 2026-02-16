import { normalizeGithubOwner, parseGithubOwnerFromProjectId } from "@/lib/github-owner"

type RepoWorkspaceRoutingMode = "auto" | "active_workspace"

interface UserMemoryRow {
  id: string
  current_org_id: string | null
  plan: string | null
  turso_db_url: string | null
  turso_db_token: string | null
  turso_db_name: string | null
  repo_workspace_routing_mode?: RepoWorkspaceRoutingMode | null
  repo_owner_org_mappings?: unknown
}

type OrgSubscriptionStatus = "active" | "past_due" | "cancelled" | null

interface OrganizationMemoryRow {
  id: string
  slug: string | null
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

type MemorySupabaseClient = {
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

const ORGANIZATION_MEMORY_COLUMNS =
  "id, slug, plan, subscription_status, stripe_subscription_id, turso_db_url, turso_db_token, turso_db_name"

const USER_MEMORY_SELECT_VARIANTS = [
  "id, current_org_id, plan, turso_db_url, turso_db_token, turso_db_name, repo_workspace_routing_mode, repo_owner_org_mappings",
  "id, current_org_id, plan, turso_db_url, turso_db_token, turso_db_name, repo_workspace_routing_mode",
  "id, current_org_id, plan, turso_db_url, turso_db_token, turso_db_name",
] as const

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
  // Optional project identifier (e.g. github.com/acme/repo) used for repo-aware workspace routing.
  projectId?: string | null
}

function toUserContext(user: UserMemoryRow): ActiveMemoryContext {
  return {
    ownerType: "user",
    userId: user.id,
    orgId: null,
    orgRole: null,
    plan: normalizeUserPlan(user.plan),
    turso_db_url: user.turso_db_url,
    turso_db_token: user.turso_db_token,
    turso_db_name: user.turso_db_name,
  }
}

function normalizeUserPlan(plan: string | null | undefined): string {
  if (plan === "past_due") return "past_due"
  if (plan === "growth" || plan === "enterprise") return "growth"
  if (plan === "team") return "team"
  if (plan === "individual" || plan === "pro") return "individual"
  return "free"
}

function normalizeOrganizationActivePlan(plan: string | null | undefined): string {
  if (plan === "growth" || plan === "enterprise") return "growth"
  if (plan === "team" || plan === "pro" || plan === "individual") return "team"
  return "team"
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

  if (org.subscription_status === "active") {
    if (org.plan) {
      return normalizeOrganizationActivePlan(org.plan)
    }
    if (org.stripe_subscription_id) {
      return "team"
    }
  }

  if (org.plan) {
    return normalizeUserPlan(org.plan)
  }

  return normalizeUserPlan(fallbackPlan)
}

function normalizeRoutingMode(value: string | null | undefined): RepoWorkspaceRoutingMode {
  return value === "active_workspace" ? "active_workspace" : "auto"
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return (
    message.includes("column") &&
    message.includes(columnName.toLowerCase()) &&
    message.includes("does not exist")
  )
}

function isMissingAnyColumnError(error: unknown, columnNames: string[]): boolean {
  return columnNames.some((columnName) => isMissingColumnError(error, columnName))
}

async function loadUserMemoryRow(
  supabase: MemorySupabaseClient,
  userId: string
): Promise<{ data: UserMemoryRow | null; error: unknown }> {
  for (const selectColumns of USER_MEMORY_SELECT_VARIANTS) {
    const query = await supabase
      .from("users")
      .select(selectColumns)
      .eq("id", userId)
      .single()

    if (!query.error || !isMissingAnyColumnError(query.error, ["repo_owner_org_mappings", "repo_workspace_routing_mode"])) {
      return {
        data: query.data as UserMemoryRow | null,
        error: query.error,
      }
    }
  }

  return {
    data: null,
    error: { message: "Failed to load user profile" },
  }
}

function parseRepoOwnerMappings(value: unknown): Map<string, string> {
  if (!Array.isArray(value)) {
    return new Map()
  }

  const mappings = new Map<string, string>()

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue
    }

    const ownerRaw = "owner" in entry ? (entry as { owner?: unknown }).owner : null
    const orgIdRaw = "org_id" in entry ? (entry as { org_id?: unknown }).org_id : null

    const owner = normalizeGithubOwner(typeof ownerRaw === "string" ? ownerRaw : null)
    const orgId = typeof orgIdRaw === "string" ? orgIdRaw.trim() : ""

    if (!owner || !orgId || mappings.has(owner)) {
      continue
    }

    mappings.set(owner, orgId)
  }

  return mappings
}

function toOrganizationContext(
  org: OrganizationMemoryRow,
  membership: OrgMembershipRow,
  userId: string,
  userPlan: string | null
): ActiveMemoryContext {
  return {
    ownerType: "organization",
    userId,
    orgId: org.id,
    orgRole: membership.role,
    plan: resolveOrganizationPlan(org, userPlan),
    turso_db_url: org.turso_db_url,
    turso_db_token: org.turso_db_token,
    turso_db_name: org.turso_db_name,
  }
}

async function resolveAutoRoutedOrganizationContext(
  supabase: MemorySupabaseClient,
  userId: string,
  userPlan: string | null,
  lookup: { column: "id" | "slug"; value: string }
): Promise<ActiveMemoryContext | null> {
  const { data: orgData, error: orgError } = await supabase
    .from("organizations")
    .select(ORGANIZATION_MEMORY_COLUMNS)
    .eq(lookup.column, lookup.value)
    .single()

  if (orgError || !orgData) {
    return null
  }

  const org = orgData as OrganizationMemoryRow
  const { data: membershipData, error: membershipError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", userId)
    .single()

  if (membershipError || !membershipData) {
    return null
  }

  // Auto mode should never strand requests on an org without Turso credentials.
  if (!org.turso_db_url || !org.turso_db_token) {
    return null
  }

  return toOrganizationContext(org, membershipData as OrgMembershipRow, userId, userPlan)
}

export async function resolveActiveMemoryContext(
  client: unknown,
  userId: string,
  options: ResolveActiveMemoryContextOptions = {}
): Promise<ActiveMemoryContext | null> {
  const supabase = client as MemorySupabaseClient

  const fallbackToUserWithoutOrgCredentials =
    options.fallbackToUserWithoutOrgCredentials ?? false

  const { data: userData, error: userError } = await loadUserMemoryRow(supabase, userId)

  if (userError || !userData) {
    return null
  }

  const user = userData as UserMemoryRow
  const userContext = toUserContext(user)
  const routingMode = normalizeRoutingMode(user.repo_workspace_routing_mode)
  const projectOwner = parseGithubOwnerFromProjectId(options.projectId)

  // Default behavior: repo-scoped memories route by GitHub owner.
  // Explicit owner mappings take precedence, then slug matching is used.
  // Otherwise route to personal workspace.
  if (routingMode === "auto" && options.projectId?.trim()) {
    if (!projectOwner) {
      return userContext
    }

    const ownerMappings = parseRepoOwnerMappings(user.repo_owner_org_mappings)
    const mappedOrgId = ownerMappings.get(projectOwner)
    if (mappedOrgId) {
      const mappedContext = await resolveAutoRoutedOrganizationContext(
        supabase,
        userId,
        user.plan,
        { column: "id", value: mappedOrgId }
      )

      if (mappedContext) {
        return mappedContext
      }
    }

    const slugContext = await resolveAutoRoutedOrganizationContext(
      supabase,
      userId,
      user.plan,
      { column: "slug", value: projectOwner }
    )

    if (slugContext) {
      return slugContext
    }

    return userContext
  }

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
    .select(ORGANIZATION_MEMORY_COLUMNS)
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

  return toOrganizationContext(org, membership, userId, user.plan)
}
