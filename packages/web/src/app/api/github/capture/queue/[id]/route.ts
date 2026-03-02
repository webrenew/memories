import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createTurso } from "@libsql/client"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, githubCaptureDecisionSchema } from "@/lib/validations"
import { addMemoryPayload } from "@/lib/memory-service/mutations"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/tools"

const APPROVAL_LOCK_PREFIX = "__approval_lock__:"
const APPROVAL_LOCK_STALE_MS = 10 * 60 * 1000

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
  approved_memory_id: string | null
  reviewed_at: string | null
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

function buildApprovalLockToken(userId: string): string {
  return `${APPROVAL_LOCK_PREFIX}${userId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
}

function isApprovalLockToken(value: string | null): value is string {
  return typeof value === "string" && value.startsWith(APPROVAL_LOCK_PREFIX)
}

function isStaleApprovalLock(reviewedAt: string | null): boolean {
  if (!reviewedAt) return false
  const reviewedAtMs = Date.parse(reviewedAt)
  if (!Number.isFinite(reviewedAtMs)) return true
  return reviewedAtMs <= Date.now() - APPROVAL_LOCK_STALE_MS
}

async function fetchQueueItem(
  admin: ReturnType<typeof createAdminClient>,
  queueId: string
): Promise<{ item: QueueItemRow | null; error: unknown }> {
  const { data, error } = await admin
    .from("github_capture_queue")
    .select(
      "id, target_owner_type, target_user_id, target_org_id, status, source_event, source_action, repo_full_name, project_id, actor_login, source_id, title, content, source_url, approved_memory_id, reviewed_at, metadata"
    )
    .eq("id", queueId)
    .single()

  if (error) {
    return { item: null, error }
  }

  return {
    item: (data as QueueItemRow | null) ?? null,
    error: null,
  }
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
  const { item, error: itemLookupError } = await fetchQueueItem(admin, id)
  if (itemLookupError) {
    console.error("Failed to load capture queue item:", {
      queueId: id,
      reviewerUserId: user.id,
      error: itemLookupError,
    })
    return NextResponse.json({ error: "Failed to load capture queue item" }, { status: 500 })
  }

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
    const rejectResponse = await admin
      .from("github_capture_queue")
      .update({
        status: "rejected",
        reviewed_by: user.id,
        reviewed_at: nowIso,
        decision_note: parsed.data.note ?? null,
      })
      .eq("id", id)
      .eq("status", "pending")
      .is("approved_memory_id", null)
      .select("id, status")
      .maybeSingle()

    if (rejectResponse.error) {
      console.error("Failed to reject capture queue item:", {
        queueId: id,
        reviewerUserId: user.id,
        error: rejectResponse.error,
      })
      return NextResponse.json({ error: "Failed to update capture queue item" }, { status: 500 })
    }

    if (!rejectResponse.data) {
      const { item: latestItem, error: latestError } = await fetchQueueItem(admin, id)
      if (latestError) {
        console.error("Failed to read latest capture queue item after reject conflict:", {
          queueId: id,
          reviewerUserId: user.id,
          error: latestError,
        })
        return NextResponse.json({ error: "Failed to update capture queue item" }, { status: 500 })
      }

      if (!latestItem) {
        return NextResponse.json({ error: "Capture queue item not found" }, { status: 404 })
      }

      return NextResponse.json(
        {
          error: `Capture queue item is already ${latestItem.status}`,
        },
        { status: 409 }
      )
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

  if (isApprovalLockToken(item.approved_memory_id) && !isStaleApprovalLock(item.reviewed_at)) {
    return NextResponse.json(
      {
        error: "Capture queue item is currently being approved",
      },
      { status: 409 }
    )
  }

  if (isApprovalLockToken(item.approved_memory_id) && isStaleApprovalLock(item.reviewed_at)) {
    const staleLockRelease = await admin
      .from("github_capture_queue")
      .update({
        reviewed_by: null,
        reviewed_at: null,
        decision_note: null,
        approved_memory_id: null,
      })
      .eq("id", id)
      .eq("status", "pending")
      .eq("approved_memory_id", item.approved_memory_id)

    if (staleLockRelease.error) {
      console.error("Failed to release stale approval lock for capture queue item:", {
        queueId: id,
        reviewerUserId: user.id,
        lockToken: item.approved_memory_id,
        error: staleLockRelease.error,
      })
      return NextResponse.json({ error: "Failed to update capture queue item" }, { status: 500 })
    }
  }

  const approvalLockToken = buildApprovalLockToken(user.id)
  const claimResponse = await admin
    .from("github_capture_queue")
    .update({
      reviewed_by: user.id,
      reviewed_at: nowIso,
      decision_note: parsed.data.note ?? null,
      approved_memory_id: approvalLockToken,
    })
    .eq("id", id)
    .eq("status", "pending")
    .is("approved_memory_id", null)
    .select("id")
    .maybeSingle()

  if (claimResponse.error) {
    console.error("Failed to claim capture queue item for approval:", {
      queueId: id,
      reviewerUserId: user.id,
      error: claimResponse.error,
    })
    return NextResponse.json({ error: "Failed to update capture queue item" }, { status: 500 })
  }

  if (!claimResponse.data) {
    const { item: latestItem, error: latestError } = await fetchQueueItem(admin, id)
    if (latestError) {
      console.error("Failed to read latest capture queue item after approval claim conflict:", {
        queueId: id,
        reviewerUserId: user.id,
        error: latestError,
      })
      return NextResponse.json({ error: "Failed to update capture queue item" }, { status: 500 })
    }

    if (!latestItem) {
      return NextResponse.json({ error: "Capture queue item not found" }, { status: 404 })
    }

    return NextResponse.json(
      {
        error: `Capture queue item is already ${latestItem.status}`,
      },
      { status: 409 }
    )
  }

  const creds = await resolveWorkspaceCredentials(admin, item)
  if (!creds?.turso_db_url || !creds?.turso_db_token) {
    await admin
      .from("github_capture_queue")
      .update({
        reviewed_by: null,
        reviewed_at: null,
        decision_note: null,
        approved_memory_id: null,
      })
      .eq("id", id)
      .eq("status", "pending")
      .eq("approved_memory_id", approvalLockToken)

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

  let payload: Awaited<ReturnType<typeof addMemoryPayload>>
  try {
    payload = await addMemoryPayload({
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
  } catch (memoryError) {
    await admin
      .from("github_capture_queue")
      .update({
        reviewed_by: null,
        reviewed_at: null,
        decision_note: null,
        approved_memory_id: null,
      })
      .eq("id", id)
      .eq("status", "pending")
      .eq("approved_memory_id", approvalLockToken)

    console.error("Failed to insert memory while approving capture queue item:", {
      queueId: id,
      reviewerUserId: user.id,
      error: memoryError,
    })
    return NextResponse.json({ error: "Failed to insert approved memory" }, { status: 500 })
  }

  const finalizeResponse = await admin
    .from("github_capture_queue")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: nowIso,
      decision_note: parsed.data.note ?? null,
      approved_memory_id: payload.data.id,
    })
    .eq("id", id)
    .eq("status", "pending")
    .eq("approved_memory_id", approvalLockToken)
    .select("id")
    .maybeSingle()

  if (finalizeResponse.error) {
    console.error("Failed to approve capture queue item:", {
      queueId: id,
      reviewerUserId: user.id,
      approvedMemoryId: payload.data.id,
      error: finalizeResponse.error,
    })
    return NextResponse.json({ error: "Failed to update capture queue item" }, { status: 500 })
  }

  if (!finalizeResponse.data) {
    const { item: latestItem, error: latestError } = await fetchQueueItem(admin, id)
    if (latestError) {
      console.error("Failed to read latest capture queue item after approval finalize conflict:", {
        queueId: id,
        reviewerUserId: user.id,
        approvedMemoryId: payload.data.id,
        error: latestError,
      })
      return NextResponse.json({ error: "Failed to update capture queue item" }, { status: 500 })
    }

    if (latestItem?.status === "approved" && latestItem.approved_memory_id === payload.data.id) {
      return NextResponse.json({
        ok: true,
        status: "approved",
        memory_id: payload.data.id,
      })
    }

    console.error("Approval finalize claim lost for capture queue item:", {
      queueId: id,
      reviewerUserId: user.id,
      approvedMemoryId: payload.data.id,
      latestStatus: latestItem?.status ?? null,
      latestApprovedMemoryId: latestItem?.approved_memory_id ?? null,
    })
    return NextResponse.json({ error: "Failed to update capture queue item" }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    status: "approved",
    memory_id: payload.data.id,
  })
}
