import { authenticateRequest } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { apiRateLimit, checkPreAuthApiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, updateUserSchema } from "@/lib/validations"

type UserProfileRow = {
  id: string
  email: string | null
  name: string | null
  plan: string | null
  embedding_model: string | null
  current_org_id: string | null
  repo_workspace_routing_mode?: "auto" | "active_workspace" | null
}

type WorkspaceSwitchEventInput = {
  userId: string
  fromOrgId: string | null
  toOrgId: string | null
  durationMs: number
  success: boolean
  errorCode: string | null
}

type AdminClient = ReturnType<typeof createAdminClient>

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

function workspaceCacheBustKey(userId: string): string {
  return `${userId}:${Date.now()}`
}

async function readCurrentOrgId(admin: AdminClient, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("users")
    .select("current_org_id")
    .eq("id", userId)
    .single()

  if (error || !data) return null
  return (data.current_org_id as string | null) ?? null
}

async function recordWorkspaceSwitchEvent(admin: AdminClient, event: WorkspaceSwitchEventInput): Promise<void> {
  try {
    const { error } = await admin.from("workspace_switch_events").insert({
      user_id: event.userId,
      from_org_id: event.fromOrgId,
      to_org_id: event.toOrgId,
      duration_ms: Math.max(0, Math.floor(event.durationMs)),
      success: event.success,
      source: "dashboard",
      error_code: event.errorCode,
    })

    if (error) {
      if (isMissingTableError(error, "workspace_switch_events")) {
        return
      }
      console.warn("Failed to record workspace switch event:", error)
    }
  } catch (error) {
    if (isMissingTableError(error, "workspace_switch_events")) {
      return
    }
    console.warn("Workspace switch telemetry insert failed:", error)
  }
}

export async function GET(request: Request): Promise<Response> {
  const preAuthRateLimited = await checkPreAuthApiRateLimit(request)
  if (preAuthRateLimited) return preAuthRateLimited

  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  const primaryQuery = await admin
    .from("users")
    .select("id, email, name, plan, embedding_model, current_org_id, repo_workspace_routing_mode")
    .eq("id", auth.userId)
    .single()
  let profile = primaryQuery.data as UserProfileRow | null
  let error = primaryQuery.error

  if (error && isMissingColumnError(error, "repo_workspace_routing_mode")) {
    const fallback = await admin
      .from("users")
      .select("id, email, name, plan, embedding_model, current_org_id")
      .eq("id", auth.userId)
      .single()
    profile = fallback.data as UserProfileRow | null
    error = fallback.error
  }

  if (error || !profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  return NextResponse.json({
    user: {
      ...profile,
      repo_workspace_routing_mode: profile.repo_workspace_routing_mode ?? "auto",
    },
  })
}

export async function PATCH(request: Request): Promise<Response> {
  const preAuthRateLimited = await checkPreAuthApiRateLimit(request)
  if (preAuthRateLimited) return preAuthRateLimited

  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const parsed = parseBody(updateUserSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response

  const admin = createAdminClient()
  const updates: Record<string, string | null> = {}

  if (parsed.data.name !== undefined) {
    updates.name = parsed.data.name
  }

  if (parsed.data.embedding_model !== undefined) {
    updates.embedding_model = parsed.data.embedding_model
  }

  if (parsed.data.repo_workspace_routing_mode !== undefined) {
    updates.repo_workspace_routing_mode = parsed.data.repo_workspace_routing_mode
  }

  const switchRequested = parsed.data.current_org_id !== undefined
  const switchStartedAt = switchRequested ? Date.now() : null
  const switchFromOrgId = switchRequested ? await readCurrentOrgId(admin, auth.userId) : null
  const switchToOrgId = switchRequested
    ? (parsed.data.current_org_id as string | null)
    : null

  if (switchRequested) {
    const nextOrgId = parsed.data.current_org_id

    if (nextOrgId == null) {
      updates.current_org_id = null
    } else if (typeof nextOrgId === "string") {
      const { data: membership, error: membershipError } = await admin
        .from("org_members")
        .select("id")
        .eq("org_id", nextOrgId)
        .eq("user_id", auth.userId)
        .maybeSingle()

      if (membershipError) {
        if (switchStartedAt !== null) {
          await recordWorkspaceSwitchEvent(admin, {
            userId: auth.userId,
            fromOrgId: switchFromOrgId,
            toOrgId: switchToOrgId,
            durationMs: Date.now() - switchStartedAt,
            success: false,
            errorCode: "membership_lookup_failed",
          })
        }

        console.error("Workspace switch membership lookup failed:", {
          error: membershipError,
          userId: auth.userId,
          fromOrgId: switchFromOrgId,
          toOrgId: switchToOrgId,
        })
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 })
      }

      if (!membership) {
        if (switchStartedAt !== null) {
          await recordWorkspaceSwitchEvent(admin, {
            userId: auth.userId,
            fromOrgId: switchFromOrgId,
            toOrgId: switchToOrgId,
            durationMs: Date.now() - switchStartedAt,
            success: false,
            errorCode: "membership_denied",
          })
        }

        return NextResponse.json(
          { error: "You are not a member of that organization" },
          { status: 403 }
        )
      }

      updates.current_org_id = nextOrgId
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const { error } = await admin
    .from("users")
    .update(updates)
    .eq("id", auth.userId)

  if (error) {
    if (switchStartedAt !== null) {
      await recordWorkspaceSwitchEvent(admin, {
        userId: auth.userId,
        fromOrgId: switchFromOrgId,
        toOrgId: switchToOrgId,
        durationMs: Date.now() - switchStartedAt,
        success: false,
        errorCode: "update_failed",
      })
    }

    console.error("User update error:", error)
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 })
  }

  if (switchStartedAt !== null) {
    await recordWorkspaceSwitchEvent(admin, {
      userId: auth.userId,
      fromOrgId: switchFromOrgId,
      toOrgId: switchToOrgId,
      durationMs: Date.now() - switchStartedAt,
      success: true,
      errorCode: null,
    })
  }

  const response: { ok: true; workspace_cache_bust_key?: string } = { ok: true }
  if (switchRequested) {
    response.workspace_cache_bust_key = workspaceCacheBustKey(auth.userId)
  }

  return NextResponse.json(response)
}
