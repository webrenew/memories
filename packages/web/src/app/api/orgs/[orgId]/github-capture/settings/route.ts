import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logOrgAuditEvent } from "@/lib/org-audit"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, updateGithubCaptureSettingsSchema } from "@/lib/validations"
import { z } from "zod"
import {
  buildGithubCaptureSettingsFromRow,
  normalizeActorFilterList,
  normalizeAllowedEvents,
  normalizeBranchFilterList,
  normalizeLabelFilterList,
  normalizeRepoFilterList,
} from "@/lib/github-capture-settings"

interface OrgMembershipRow {
  role: "owner" | "admin" | "member"
}

interface GithubCaptureSettingsRow {
  id: string
  allowed_events: string[]
  repo_allow_list: string[]
  repo_block_list: string[]
  branch_filters: string[]
  label_filters: string[]
  actor_filters: string[]
  include_prerelease: boolean
  updated_at: string | null
}

const SETTINGS_SELECT =
  "id, allowed_events, repo_allow_list, repo_block_list, branch_filters, label_filters, actor_filters, include_prerelease, updated_at"

function canManage(role: OrgMembershipRow["role"] | undefined): boolean {
  return role === "owner" || role === "admin"
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

function buildSettingsUpdates(input: Partial<z.infer<typeof updateGithubCaptureSettingsSchema>>): {
  updates: Record<string, unknown>
  error: string | null
} {
  const updates: Record<string, unknown> = {}

  if (input.allowed_events !== undefined) {
    const normalized = normalizeAllowedEvents(input.allowed_events)
    if (normalized.length === 0) {
      return {
        updates: {},
        error: "Select at least one allowed event",
      }
    }
    updates.allowed_events = normalized
  }

  if (input.repo_allow_list !== undefined) {
    updates.repo_allow_list = normalizeRepoFilterList(input.repo_allow_list)
  }

  if (input.repo_block_list !== undefined) {
    updates.repo_block_list = normalizeRepoFilterList(input.repo_block_list)
  }

  if (input.branch_filters !== undefined) {
    updates.branch_filters = normalizeBranchFilterList(input.branch_filters)
  }

  if (input.label_filters !== undefined) {
    updates.label_filters = normalizeLabelFilterList(input.label_filters)
  }

  if (input.actor_filters !== undefined) {
    updates.actor_filters = normalizeActorFilterList(input.actor_filters)
  }

  if (input.include_prerelease !== undefined) {
    updates.include_prerelease = input.include_prerelease
  }

  return { updates, error: null }
}

async function loadOrgSettingsRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<{ row: GithubCaptureSettingsRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from("github_capture_settings")
    .select(SETTINGS_SELECT)
    .eq("target_owner_type", "organization")
    .eq("target_org_id", orgId)
    .limit(1)

  if (error) {
    return { row: null, error }
  }

  const row = ((data ?? [])[0] as GithubCaptureSettingsRow | undefined) ?? null
  return { row, error: null }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  const { orgId } = await params
  const supabase = await createClient()
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
    console.error("Failed to verify GitHub capture settings access:", {
      error: membershipError,
      orgId,
      userId: user.id,
      method: "GET",
    })
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 })
  }

  const role = (membership as OrgMembershipRow | null)?.role
  if (!canManage(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const { row, error } = await loadOrgSettingsRow(supabase, orgId)
  if (error) {
    if (isMissingTableError(error, "github_capture_settings")) {
      return NextResponse.json(
        {
          error: "GitHub capture settings table is missing. Run the latest database migration.",
          settings: buildGithubCaptureSettingsFromRow(null),
          configured: false,
        },
        { status: 503 },
      )
    }

    console.error("Failed to load GitHub capture settings row:", {
      error,
      orgId,
      userId: user.id,
      method: "GET",
    })
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 })
  }

  return NextResponse.json({
    settings: buildGithubCaptureSettingsFromRow(row),
    configured: Boolean(row),
    updated_at: row?.updated_at ?? null,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  const { orgId } = await params
  const supabase = await createClient()
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
    console.error("Failed to verify GitHub capture settings access:", {
      error: membershipError,
      orgId,
      userId: user.id,
      method: "PATCH",
    })
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 })
  }

  const role = (membership as OrgMembershipRow | null)?.role
  if (!canManage(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const parsed = parseBody(updateGithubCaptureSettingsSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response

  const { updates, error: updatesError } = buildSettingsUpdates(parsed.data)
  if (updatesError) {
    return NextResponse.json({ error: updatesError }, { status: 400 })
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const { row: existingRow, error: existingError } = await loadOrgSettingsRow(supabase, orgId)
  if (existingError) {
    if (isMissingTableError(existingError, "github_capture_settings")) {
      return NextResponse.json(
        {
          error: "GitHub capture settings table is missing. Run the latest database migration.",
        },
        { status: 503 },
      )
    }
    console.error("Failed to load existing GitHub capture settings row:", {
      error: existingError,
      orgId,
      userId: user.id,
      method: "PATCH",
    })
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 })
  }

  const timestamp = new Date().toISOString()
  const writePayload = {
    ...updates,
    updated_at: timestamp,
  }

  const response = existingRow
    ? await supabase
        .from("github_capture_settings")
        .update(writePayload)
        .eq("id", existingRow.id)
        .select(SETTINGS_SELECT)
        .single()
    : await supabase
        .from("github_capture_settings")
        .insert({
          target_owner_type: "organization",
          target_org_id: orgId,
          target_user_id: null,
          ...writePayload,
        })
        .select(SETTINGS_SELECT)
        .single()

  if (response.error || !response.data) {
    if (isMissingTableError(response.error, "github_capture_settings")) {
      return NextResponse.json(
        {
          error: "GitHub capture settings table is missing. Run the latest database migration.",
        },
        { status: 503 },
      )
    }

    console.error("Failed to persist GitHub capture settings row:", {
      error: response.error,
      orgId,
      userId: user.id,
      method: existingRow ? "PATCH:update" : "PATCH:insert",
      updatedFields: Object.keys(updates).sort(),
    })
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 })
  }

  const row = response.data as GithubCaptureSettingsRow

  await logOrgAuditEvent({
    client: supabase,
    orgId,
    actorUserId: user.id,
    action: "org_github_capture_settings_updated",
    targetType: "organization",
    targetId: orgId,
    metadata: {
      updatedFields: Object.keys(updates).sort(),
      include_prerelease: row.include_prerelease,
      allowed_events: row.allowed_events,
      repo_allow_list_count: row.repo_allow_list.length,
      repo_block_list_count: row.repo_block_list.length,
      branch_filters_count: row.branch_filters.length,
      label_filters_count: row.label_filters.length,
      actor_filters_count: row.actor_filters.length,
    },
  })

  return NextResponse.json({
    settings: buildGithubCaptureSettingsFromRow(row),
    configured: true,
    updated_at: row.updated_at ?? null,
  })
}
