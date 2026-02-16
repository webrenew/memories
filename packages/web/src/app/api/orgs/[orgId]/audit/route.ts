import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"

interface OrgAuditLogRow {
  id: string
  actor_user_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  target_label: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface UserActorRow {
  id: string
  email: string | null
  name: string | null
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return (
    message.includes(tableName.toLowerCase()) &&
    (message.includes("does not exist") || message.includes("could not find the table"))
  )
}

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30
  return Math.max(1, Math.min(parsed, 100))
}

// GET /api/orgs/[orgId]/audit - List organization audit events
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
): Promise<Response> {
  const { orgId } = await params
  const { searchParams } = new URL(request.url)
  const limit = parseLimit(searchParams.get("limit"))
  const actionFilter = searchParams.get("action")?.trim() || null

  const supabase = await createClient()
  const admin = createAdminClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (membershipError) {
    console.error("Failed to verify audit log access membership:", {
      error: membershipError,
      orgId,
      userId: user.id,
    })
    return NextResponse.json({ error: "Failed to load audit events" }, { status: 500 })
  }

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const queryWithAction = actionFilter
    ? supabase
        .from("org_audit_logs")
        .select("id, actor_user_id, action, target_type, target_id, target_label, metadata, created_at")
        .eq("org_id", orgId)
        .eq("action", actionFilter)
        .order("created_at", { ascending: false })
        .limit(limit)
    : supabase
        .from("org_audit_logs")
        .select("id, actor_user_id, action, target_type, target_id, target_label, metadata, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(limit)

  const { data: logs, error: logsError } = await queryWithAction
  if (logsError) {
    if (isMissingTableError(logsError, "org_audit_logs")) {
      return NextResponse.json(
        {
          error: "Audit log table is missing. Run the latest database migration.",
          events: [],
        },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: logsError.message }, { status: 500 })
  }

  const rows = (logs ?? []) as OrgAuditLogRow[]
  const actorIds = [...new Set(rows.map((row) => row.actor_user_id).filter(Boolean))] as string[]
  let actorById = new Map<string, UserActorRow>()

  if (actorIds.length > 0) {
    const { data: actors, error: actorError } = await admin
      .from("users")
      .select("id, email, name")
      .in("id", actorIds)

    if (!actorError && actors) {
      actorById = new Map((actors as UserActorRow[]).map((actor) => [actor.id, actor]))
    }
  }

  const events = rows.map((row) => ({
    id: row.id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    target_label: row.target_label,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    actor_user_id: row.actor_user_id,
    actor: row.actor_user_id ? actorById.get(row.actor_user_id) ?? null : null,
  }))

  return NextResponse.json({ events })
}
