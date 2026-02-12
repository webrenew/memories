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
  source_event: "pull_request" | "issues" | "push"
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

function canReviewOrgRole(role: OrgMembershipRow["role"] | undefined): boolean {
  return role === "owner" || role === "admin"
}

function normalizeLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 50
  return Math.min(100, Math.max(1, Math.floor(parsed)))
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

export async function GET(request: Request) {
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
  const limit = normalizeLimit(url.searchParams.get("limit"))

  const admin = createAdminClient()
  const { data: memberships, error: membershipsError } = await admin
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)

  if (membershipsError) {
    return NextResponse.json({ error: membershipsError.message }, { status: 500 })
  }

  const orgMemberships = (memberships ?? []) as OrgMembershipRow[]
  const orgRoleById = new Map(orgMemberships.map((membership) => [membership.org_id, membership.role]))
  const orgIds = orgMemberships.map((membership) => membership.org_id)

  try {
    const [userRows, orgRows] = await Promise.all([
      loadRowsForUserTarget(admin, user.id, status, limit),
      loadRowsForOrgTargets(admin, orgIds, status, limit),
    ])

    const rows = [...userRows, ...orgRows]
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
      .slice(0, limit)

    const queue = rows.map((row) => {
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

    return NextResponse.json({ queue })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load queue"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
