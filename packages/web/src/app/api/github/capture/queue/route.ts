import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"

interface QueueRow {
  id: string
  target_owner_type: "user" | "organization"
  target_user_id: string | null
  target_org_id: string | null
  status: "pending" | "approved" | "rejected"
  source_event: "pull_request" | "issues" | "push" | "release"
  source_action: string | null
  repo_full_name: string
  project_id: string
  actor_login: string | null
  source_id: string
  title: string | null
  content: string
  source_url: string | null
  metadata: Record<string, unknown>
  reviewed_by: string | null
  reviewed_at: string | null
  decision_note: string | null
  approved_memory_id: string | null
  created_at: string
  updated_at: string
}

interface OrgMembershipRow {
  org_id: string
  role: "owner" | "admin" | "member"
}

function isQueueStatus(value: string | null): value is QueueRow["status"] | "all" {
  return value === "pending" || value === "approved" || value === "rejected" || value === "all"
}

function isQueueEvent(value: string | null): value is QueueRow["source_event"] | "all" {
  return (
    value === "pull_request" ||
    value === "issues" ||
    value === "push" ||
    value === "release" ||
    value === "all"
  )
}

function normalizeFilterValue(value: string | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function canReviewOrgRole(role: OrgMembershipRow["role"] | undefined): boolean {
  return role === "owner" || role === "admin"
}

function normalizeLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 50
  return Math.min(200, Math.max(1, Math.floor(parsed)))
}

async function loadRowsForUserTarget(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  status: QueueRow["status"] | "all",
  limit: number
): Promise<QueueRow[]> {
  let query = admin
    .from("github_capture_queue")
    .select("*")
    .eq("target_owner_type", "user")
    .eq("target_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (status !== "all") {
    query = query.eq("status", status)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as QueueRow[]
}

async function loadRowsForOrgTargets(
  admin: ReturnType<typeof createAdminClient>,
  orgIds: string[],
  status: QueueRow["status"] | "all",
  limit: number
): Promise<QueueRow[]> {
  if (orgIds.length === 0) return []

  let query = admin
    .from("github_capture_queue")
    .select("*")
    .eq("target_owner_type", "organization")
    .in("target_org_id", orgIds)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (status !== "all") {
    query = query.eq("status", status)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as QueueRow[]
}

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const url = new URL(request.url)
  const statusParam = url.searchParams.get("status")
  const status = isQueueStatus(statusParam) ? statusParam : "pending"
  const eventParam = url.searchParams.get("event")
  const eventFilter = isQueueEvent(eventParam) ? eventParam : "all"
  const repoFilter = normalizeFilterValue(url.searchParams.get("repo"))?.toLowerCase() ?? null
  const actorFilter = normalizeFilterValue(url.searchParams.get("actor"))?.toLowerCase() ?? null
  const workspaceFilter = normalizeFilterValue(url.searchParams.get("workspace"))?.toLowerCase() ?? "all"
  const queryFilter = normalizeFilterValue(url.searchParams.get("q"))?.toLowerCase() ?? null
  const limit = normalizeLimit(url.searchParams.get("limit"))

  const admin = createAdminClient()
  const { data: memberships, error: membershipsError } = await admin
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)

  if (membershipsError) {
    console.error("Failed to load capture queue memberships:", {
      userId: user.id,
      error: membershipsError,
    })
    return NextResponse.json({ error: "Failed to load queue" }, { status: 500 })
  }

  const orgMemberships = (memberships ?? []) as OrgMembershipRow[]
  const orgRoleById = new Map(orgMemberships.map((membership) => [membership.org_id, membership.role]))
  const orgIds = orgMemberships.map((membership) => membership.org_id)
  const allowedOrgIds = new Set(orgIds)

  const shouldIncludePersonal =
    workspaceFilter === "all" ||
    workspaceFilter === "personal" ||
    workspaceFilter === `user:${user.id.toLowerCase()}`

  const requestedOrgId =
    workspaceFilter.startsWith("org:") && workspaceFilter.length > 4
      ? workspaceFilter.slice(4)
      : null

  const filteredOrgIds =
    requestedOrgId && allowedOrgIds.has(requestedOrgId)
      ? [requestedOrgId]
      : requestedOrgId
        ? []
        : orgIds

  try {
    const [userRows, orgRows] = await Promise.all([
      shouldIncludePersonal ? loadRowsForUserTarget(admin, user.id, status, limit) : Promise.resolve([]),
      loadRowsForOrgTargets(admin, filteredOrgIds, status, limit),
    ])

    const rows = [...userRows, ...orgRows]
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))

    const queue = rows
      .filter((row) => {
        if (eventFilter !== "all" && row.source_event !== eventFilter) return false
        if (repoFilter && !row.repo_full_name.toLowerCase().includes(repoFilter)) return false
        if (actorFilter && (row.actor_login ?? "").toLowerCase() !== actorFilter) return false
        if (queryFilter) {
          const haystack = [
            row.title ?? "",
            row.content,
            row.source_id,
            row.repo_full_name,
            row.project_id,
            row.actor_login ?? "",
            row.source_action ?? "",
          ]
            .join(" ")
            .toLowerCase()
          if (!haystack.includes(queryFilter)) return false
        }
        return true
      })
      .map((row) => {
      const orgRole = row.target_org_id ? orgRoleById.get(row.target_org_id) : undefined
      const canApprove =
        row.target_owner_type === "user"
          ? row.target_user_id === user.id
          : canReviewOrgRole(orgRole)

      return {
        ...row,
        can_approve: canApprove,
        workspace: row.target_owner_type === "user" ? "personal" : `org:${row.target_org_id}`,
      }
    })
      .slice(0, limit)

    return NextResponse.json({ queue })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load queue"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
