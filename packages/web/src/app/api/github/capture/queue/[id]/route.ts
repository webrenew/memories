import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createTurso } from "@libsql/client"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, githubCaptureDecisionSchema } from "@/lib/validations"
import { addMemoryPayload } from "@/lib/memory-service/mutations"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/tools"

interface QueueItemRow {
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
  metadata: Record<string, unknown> | null
}

interface OrgMembershipRow {
  role: "owner" | "admin" | "member"
}

interface WorkspaceTursoRow {
  turso_db_url: string | null
  turso_db_token: string | null
  turso_db_name: string | null
}

function canReviewRole(role: OrgMembershipRow["role"] | null): boolean {
  return role === "owner" || role === "admin"
}

function memoryTypeForEvent(event: QueueItemRow["source_event"]): "rule" | "decision" | "fact" | "note" | "skill" {
  if (event === "pull_request") return "decision"
  if (event === "push") return "fact"
  if (event === "release") return "note"
  return "note"
}

async function fetchQueueItem(
  admin: ReturnType<typeof createAdminClient>,
  queueId: string
): Promise<QueueItemRow | null> {
  const { data, error } = await admin
    .from("github_capture_queue")
    .select(
      "id, target_owner_type, target_user_id, target_org_id, status, source_event, source_action, repo_full_name, project_id, actor_login, source_id, title, content, source_url, metadata"
    )
    .eq("id", queueId)
    .single()

  if (error || !data) return null
  return data as QueueItemRow
}

async function resolveOrgRole(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  userId: string
): Promise<OrgMembershipRow["role"] | null> {
  const { data } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single()

  return ((data as OrgMembershipRow | null)?.role ?? null)
}

async function resolveWorkspaceCredentials(
  admin: ReturnType<typeof createAdminClient>,
  item: QueueItemRow
): Promise<WorkspaceTursoRow | null> {
  if (item.target_owner_type === "user" && item.target_user_id) {
    const { data } = await admin
      .from("users")
      .select("turso_db_url, turso_db_token, turso_db_name")
      .eq("id", item.target_user_id)
      .single()

    return (data as WorkspaceTursoRow | null) ?? null
  }

  if (item.target_owner_type === "organization" && item.target_org_id) {
    const { data } = await admin
      .from("organizations")
      .select("turso_db_url, turso_db_token, turso_db_name")
      .eq("id", item.target_org_id)
      .single()

    return (data as WorkspaceTursoRow | null) ?? null
  }

  return null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(githubCaptureDecisionSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response

  const admin = createAdminClient()
  const item = await fetchQueueItem(admin, id)
  if (!item) {
    return NextResponse.json({ error: "Capture queue item not found" }, { status: 404 })
  }

  let canApprove = false
  if (item.target_owner_type === "user") {
    canApprove = item.target_user_id === user.id
  } else if (item.target_owner_type === "organization" && item.target_org_id) {
    const orgRole = await resolveOrgRole(admin, item.target_org_id, user.id)
    canApprove = canReviewRole(orgRole)
  }

  if (!canApprove) {
    return NextResponse.json({ error: "Insufficient permissions to review this item" }, { status: 403 })
  }

  const nowIso = new Date().toISOString()

  if (parsed.data.action === "reject") {
    const { error } = await admin
      .from("github_capture_queue")
      .update({
        status: "rejected",
        reviewed_by: user.id,
        reviewed_at: nowIso,
        decision_note: parsed.data.note ?? null,
      })
      .eq("id", id)

    if (error) {
      console.error("Failed to reject capture queue item:", {
        queueId: id,
        reviewerUserId: user.id,
        error,
      })
      return NextResponse.json({ error: "Failed to update capture queue item" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, status: "rejected" })
  }

  if (item.status !== "pending") {
    return NextResponse.json(
      {
        error: `Capture queue item is already ${item.status}`,
      },
      { status: 409 }
    )
  }

  const creds = await resolveWorkspaceCredentials(admin, item)
  if (!creds?.turso_db_url || !creds?.turso_db_token) {
    return NextResponse.json({ error: "Workspace database is not configured" }, { status: 409 })
  }

  const turso = createTurso({
    url: creds.turso_db_url,
    authToken: creds.turso_db_token,
  })

  await ensureMemoryUserIdSchema(turso, {
    cacheKey: creds.turso_db_name ?? creds.turso_db_url,
  })

  const tags = ["github", item.source_event, `repo:${item.repo_full_name}`]
  if (item.source_action) {
    tags.push(`action:${item.source_action}`)
  }

  const payload = await addMemoryPayload({
    turso,
    args: {
      content: item.content,
      type: memoryTypeForEvent(item.source_event),
      tags,
      category: "github",
      metadata: {
        source: "github_capture_queue",
        queue_id: item.id,
        source_event: item.source_event,
        source_action: item.source_action,
        source_id: item.source_id,
        source_url: item.source_url,
        actor_login: item.actor_login,
        repo_full_name: item.repo_full_name,
        payload: item.metadata ?? {},
      },
    },
    projectId: item.project_id,
    userId: item.target_owner_type === "user" ? item.target_user_id : null,
    nowIso,
  })

  const { error: updateError } = await admin
    .from("github_capture_queue")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: nowIso,
      decision_note: parsed.data.note ?? null,
      approved_memory_id: payload.data.id,
    })
    .eq("id", id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    status: "approved",
    memory_id: payload.data.id,
  })
}
