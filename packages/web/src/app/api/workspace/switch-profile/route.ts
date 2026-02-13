import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, workspaceSwitchProfileSchema } from "@/lib/validations"

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

function toInteger(value: number | undefined): number | null {
  if (value === undefined) return null
  return Math.max(0, Math.floor(value))
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const parsed = parseBody(workspaceSwitchProfileSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response

  const admin = createAdminClient()
  const payload = parsed.data

  try {
    const { error } = await admin.from("workspace_switch_profile_events").insert({
      user_id: auth.userId,
      from_org_id: payload.from_org_id ?? null,
      to_org_id: payload.to_org_id ?? null,
      success: payload.success,
      error_code: payload.error_code ?? null,
      source: payload.source ?? "dashboard",
      cache_mode: payload.cache_mode ?? null,
      include_summaries: payload.include_summaries ?? false,
      client_total_ms: toInteger(payload.client_total_ms),
      user_patch_ms: toInteger(payload.user_patch_ms),
      workspace_prefetch_ms: toInteger(payload.workspace_prefetch_ms),
      integration_health_prefetch_ms: toInteger(payload.integration_health_prefetch_ms),
      workspace_summary_total_ms: toInteger(payload.workspace_summary_total_ms),
      workspace_summary_query_ms: toInteger(payload.workspace_summary_query_ms),
      workspace_summary_org_count: toInteger(payload.workspace_summary_org_count),
      workspace_summary_workspace_count: toInteger(payload.workspace_summary_workspace_count),
      workspace_summary_response_bytes: toInteger(payload.workspace_summary_response_bytes),
      metadata: {},
    })

    if (error) {
      if (isMissingTableError(error, "workspace_switch_profile_events")) {
        return NextResponse.json({ ok: true, stored: false, reason: "table_missing" })
      }
      console.warn("Failed to insert workspace switch profile event:", error)
      return NextResponse.json({ error: "Failed to record workspace switch profile" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, stored: true })
  } catch (error) {
    if (isMissingTableError(error, "workspace_switch_profile_events")) {
      return NextResponse.json({ ok: true, stored: false, reason: "table_missing" })
    }
    console.warn("Workspace switch profile telemetry failed:", error)
    return NextResponse.json({ error: "Failed to record workspace switch profile" }, { status: 500 })
  }
}
