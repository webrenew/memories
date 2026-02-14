import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  buildGithubCaptureCandidates,
  inferTargetOwnerLogin,
  verifyGithubWebhookSignature,
  type CaptureTargetWorkspace,
} from "@/lib/github-capture"
import {
  buildGithubCaptureSettingsFromRow,
  filterGithubCaptureCandidatesBySettings,
  type GithubCaptureSettingsRow,
} from "@/lib/github-capture-settings"

interface OrganizationSlugRow {
  id: string
  slug: string | null
}

interface GithubAccountLinkRow {
  user_id: string
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

function isDuplicateConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false

  const code = "code" in error ? String((error as Record<string, unknown>).code ?? "") : ""
  if (code === "23505") return true

  const message = "message" in error ? String((error as Record<string, unknown>).message ?? "").toLowerCase() : ""
  return message.includes("duplicate key")
}

async function resolveCaptureTarget(
  admin: ReturnType<typeof createAdminClient>,
  ownerLogin: string
): Promise<CaptureTargetWorkspace | null> {
  const { data: orgData } = await admin
    .from("organizations")
    .select("id, slug")
    .eq("slug", ownerLogin)
    .single()

  const org = orgData as OrganizationSlugRow | null
  if (org?.id) {
    return {
      ownerType: "organization",
      userId: null,
      orgId: org.id,
    }
  }

  const { data: linkData } = await admin
    .from("github_account_links")
    .select("user_id")
    .eq("github_login", ownerLogin)
    .single()

  const link = linkData as GithubAccountLinkRow | null
  if (link?.user_id) {
    return {
      ownerType: "user",
      userId: link.user_id,
      orgId: null,
    }
  }

  return null
}

async function loadCaptureSettingsForTarget(
  admin: ReturnType<typeof createAdminClient>,
  target: CaptureTargetWorkspace,
): Promise<{ settings: ReturnType<typeof buildGithubCaptureSettingsFromRow>; error: string | null }> {
  let query = admin
    .from("github_capture_settings")
    .select(
      "allowed_events, repo_allow_list, repo_block_list, branch_filters, label_filters, actor_filters, include_prerelease",
    )
    .eq("target_owner_type", target.ownerType)

  query =
    target.ownerType === "organization"
      ? query.eq("target_org_id", target.orgId)
      : query.eq("target_user_id", target.userId)

  const { data, error } = await query.limit(1)
  if (error) {
    if (isMissingTableError(error, "github_capture_settings")) {
      return {
        settings: buildGithubCaptureSettingsFromRow(null),
        error: null,
      }
    }

    return {
      settings: buildGithubCaptureSettingsFromRow(null),
      error: error.message ?? "Failed to load capture settings",
    }
  }

  const row = ((data ?? [])[0] as GithubCaptureSettingsRow | undefined) ?? null
  return {
    settings: buildGithubCaptureSettingsFromRow(row),
    error: null,
  }
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: "GitHub webhook is not configured" }, { status: 503 })
  }

  const payloadText = await request.text()
  const signature = request.headers.get("x-hub-signature-256")
  const eventName = request.headers.get("x-github-event")?.trim() ?? ""

  const isValidSignature = verifyGithubWebhookSignature({
    payload: payloadText,
    signatureHeader: signature,
    secret,
  })

  if (!isValidSignature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
  }

  if (eventName === "ping") {
    return NextResponse.json({ ok: true, received: "ping" })
  }

  if (!["pull_request", "issues", "push", "release"].includes(eventName)) {
    return NextResponse.json({ ok: true, ignored: `unsupported_event:${eventName}` })
  }

  const ownerLogin = inferTargetOwnerLogin(payload)
  if (!ownerLogin) {
    return NextResponse.json({ ok: true, ignored: "missing_repo_owner" })
  }

  const candidates = buildGithubCaptureCandidates(eventName, payload)
  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, ignored: "no_candidates" })
  }

  const admin = createAdminClient()
  const target = await resolveCaptureTarget(admin, ownerLogin)
  if (!target) {
    return NextResponse.json({ ok: true, ignored: "no_workspace_mapping", ownerLogin })
  }

  const settingsResult = await loadCaptureSettingsForTarget(admin, target)
  if (settingsResult.error) {
    return NextResponse.json({ error: settingsResult.error }, { status: 500 })
  }

  const filterResult = filterGithubCaptureCandidatesBySettings(candidates, settingsResult.settings)
  if (filterResult.accepted.length === 0) {
    return NextResponse.json({
      ok: true,
      target,
      inserted: 0,
      duplicates: 0,
      dropped_by_policy: filterResult.dropped,
      dropped_reasons: filterResult.reasons,
      ignored: "capture_policy_filtered",
    })
  }

  let inserted = 0
  let duplicates = 0

  for (const candidate of filterResult.accepted) {
    const { error } = await admin.from("github_capture_queue").insert({
      target_owner_type: target.ownerType,
      target_user_id: target.userId,
      target_org_id: target.orgId,
      status: "pending",
      source_event: candidate.sourceEvent,
      source_action: candidate.sourceAction,
      repo_full_name: candidate.repoFullName,
      project_id: candidate.projectId,
      actor_login: candidate.actorLogin,
      source_id: candidate.sourceId,
      title: candidate.title,
      content: candidate.content,
      source_url: candidate.sourceUrl,
      metadata: candidate.metadata,
      dedup_key: candidate.dedupKey,
    })

    if (!error) {
      inserted += 1
      continue
    }

    if (isDuplicateConstraintError(error)) {
      duplicates += 1
      continue
    }

    console.error("GitHub capture insert failed:", error)
    return NextResponse.json({ error: "Failed to enqueue GitHub capture items" }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    target,
    inserted,
    duplicates,
    dropped_by_policy: filterResult.dropped,
    dropped_reasons: filterResult.reasons,
  })
}
