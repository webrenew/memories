import { authenticateRequest } from "@/lib/auth"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  normalizeActiveOrganizationPlan,
  normalizeWorkspacePlan,
  type WorkspacePlan,
} from "@/lib/workspace"
import { NextResponse } from "next/server"

interface UserWorkspaceRow {
  id: string
  plan: string | null
  current_org_id: string | null
  turso_db_url: string | null
  turso_db_token: string | null
}

interface OrganizationWorkspaceRow {
  id: string
  name: string
  slug: string
  plan: string | null
  subscription_status: "active" | "past_due" | "cancelled" | null
  stripe_subscription_id: string | null
  turso_db_url: string | null
  turso_db_token: string | null
}

interface OrgMembershipRow {
  role: "owner" | "admin" | "member"
  organization: OrganizationWorkspaceRow | OrganizationWorkspaceRow[] | null
}

interface WorkspaceSummary {
  ownerType: "user" | "organization"
  orgId: string | null
  orgRole: "owner" | "admin" | "member" | null
  plan: WorkspacePlan
  hasDatabase: boolean
  canProvision: boolean
  canManageBilling: boolean
}

const CACHE_CONTROL_WORKSPACE = "private, max-age=15, stale-while-revalidate=45"

function withProfileHeaders(
  headers: HeadersInit,
  profile: {
    totalMs: number
    summaryQueryMs: number
    userQueryMs: number
    membershipsQueryMs: number
    buildMs: number
    orgCount: number
    workspaceCount: number
  }
): Headers {
  const next = new Headers(headers)
  next.set("X-Workspace-Profile-Total-Ms", String(profile.totalMs))
  next.set("X-Workspace-Profile-Summary-Query-Ms", String(profile.summaryQueryMs))
  next.set("X-Workspace-Profile-User-Query-Ms", String(profile.userQueryMs))
  next.set("X-Workspace-Profile-Memberships-Query-Ms", String(profile.membershipsQueryMs))
  next.set("X-Workspace-Profile-Build-Ms", String(profile.buildMs))
  next.set("X-Workspace-Profile-Org-Count", String(profile.orgCount))
  next.set("X-Workspace-Profile-Workspace-Count", String(profile.workspaceCount))
  return next
}

function resolveOrganizationPlan(
  org: OrganizationWorkspaceRow,
  fallbackPlan: string | null
): WorkspacePlan {
  if (org.subscription_status === "past_due") return "past_due"
  if (org.subscription_status === "cancelled") return "free"

  if (org.subscription_status === "active") {
    if (org.plan) return normalizeActiveOrganizationPlan(org.plan)
    if (org.stripe_subscription_id) return "team"
  }

  return normalizeWorkspacePlan(org.plan ?? fallbackPlan)
}

function toPersonalSummary(user: UserWorkspaceRow): WorkspaceSummary {
  return {
    ownerType: "user",
    orgId: null,
    orgRole: null,
    plan: normalizeWorkspacePlan(user.plan),
    hasDatabase: Boolean(user.turso_db_url && user.turso_db_token),
    canProvision: true,
    canManageBilling: true,
  }
}

function toOrganizationSummary(
  membership: OrgMembershipRow,
  userPlan: string | null
): WorkspaceSummary | null {
  const organization = Array.isArray(membership.organization)
    ? membership.organization[0] ?? null
    : membership.organization

  if (!organization) return null

  const orgRole = membership.role
  return {
    ownerType: "organization",
    orgId: organization.id,
    orgRole,
    plan: resolveOrganizationPlan(organization, userPlan),
    hasDatabase: Boolean(organization.turso_db_url && organization.turso_db_token),
    canProvision: orgRole === "owner" || orgRole === "admin",
    canManageBilling: orgRole === "owner",
  }
}

export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now()
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  const { searchParams } = new URL(request.url)
  const includeSummaries =
    searchParams.get("includeSummaries") === "1" ||
    searchParams.get("includeSummaries") === "true"
  const includeProfile =
    searchParams.get("profile") === "1" || searchParams.get("profile") === "true"

  const userQueryStartedAt = Date.now()
  const userPromise = admin
    .from("users")
    .select("id, plan, current_org_id, turso_db_url, turso_db_token")
    .eq("id", auth.userId)
    .single()

  const membershipsQueryStartedAt = Date.now()
  const membershipsPromise = admin
    .from("org_members")
    .select(`
      role,
      organization:organizations(
        id,
        name,
        slug,
        plan,
        subscription_status,
        stripe_subscription_id,
        turso_db_url,
        turso_db_token
      )
    `)
    .eq("user_id", auth.userId)

  const [userResult, membershipsResult] = await Promise.all([userPromise, membershipsPromise])
  const userQueryMs = Math.max(0, Date.now() - userQueryStartedAt)
  const membershipsQueryMs = Math.max(0, Date.now() - membershipsQueryStartedAt)
  const summaryQueryMs = userQueryMs + membershipsQueryMs

  if (userResult.error || !userResult.data) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  if (membershipsResult.error) {
    console.error("Failed to load workspace memberships:", {
      userId: auth.userId,
      error: membershipsResult.error,
    })
    return NextResponse.json({ error: "Failed to load workspace" }, { status: 500 })
  }

  const buildStartedAt = Date.now()
  const userRow = userResult.data as UserWorkspaceRow
  const memberships = (membershipsResult.data ?? []) as OrgMembershipRow[]
  const personal = toPersonalSummary(userRow)

  const organizationSummaries = memberships
    .map((membership) => {
      const organization = Array.isArray(membership.organization)
        ? membership.organization[0] ?? null
        : membership.organization
      const workspace = toOrganizationSummary(membership, userRow.plan)
      if (!organization || !workspace) return null

      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role: membership.role,
        workspace,
      }
    })
    .filter(Boolean) as Array<{
    id: string
    name: string
    slug: string
    role: "owner" | "admin" | "member"
    workspace: WorkspaceSummary
  }>

  const activeOrganization = organizationSummaries.find(
    (item) => item.id === userRow.current_org_id
  )

  const responseBody: {
    workspace: WorkspaceSummary
    summaries?: {
      currentOrgId: string | null
      personal: WorkspaceSummary
      organizations: Array<{
        id: string
        name: string
        slug: string
        role: "owner" | "admin" | "member"
        workspace: WorkspaceSummary
      }>
    }
  } = {
    workspace: activeOrganization?.workspace ?? personal,
  }

  if (includeSummaries) {
    responseBody.summaries = {
      currentOrgId: userRow.current_org_id,
      personal,
      organizations: organizationSummaries,
    }
  }

  const buildMs = Math.max(0, Date.now() - buildStartedAt)
  const totalMs = Math.max(0, Date.now() - startedAt)
  const headers = includeProfile
    ? withProfileHeaders(
        {
          "Cache-Control": CACHE_CONTROL_WORKSPACE,
        },
        {
          totalMs,
          summaryQueryMs,
          userQueryMs,
          membershipsQueryMs,
          buildMs,
          orgCount: organizationSummaries.length,
          workspaceCount: organizationSummaries.length + 1,
        }
      )
    : new Headers({
        "Cache-Control": CACHE_CONTROL_WORKSPACE,
      })

  return NextResponse.json(responseBody, {
    headers,
  })
}
