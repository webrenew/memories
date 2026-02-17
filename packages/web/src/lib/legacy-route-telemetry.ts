import { createAdminClient } from "@/lib/supabase/admin"

const LEGACY_ROUTE_USAGE_TABLE = "legacy_route_usage_events"

export type LegacyRouteAuthMode = "session" | "api_key" | "unknown"

export interface LegacyRouteUsageEventInput {
  route: string
  successorRoute: string
  method: "GET" | "POST" | "DELETE"
  status: number
  requestId: string
  authMode: LegacyRouteAuthMode
  ownerUserId?: string | null
  metadata?: Record<string, unknown>
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  if (!error || typeof error !== "object") return false
  const maybe = error as { code?: string; message?: string }
  if (maybe.code === "42P01") return true
  const message = maybe.message?.toLowerCase() ?? ""
  return (
    message.includes(tableName.toLowerCase()) &&
    (message.includes("does not exist") || message.includes("could not find the table"))
  )
}

export async function recordLegacyRouteUsageEvent(input: LegacyRouteUsageEventInput): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from(LEGACY_ROUTE_USAGE_TABLE).insert({
      route: input.route,
      successor_route: input.successorRoute,
      method: input.method,
      status: input.status,
      was_success: input.status >= 200 && input.status < 400,
      auth_mode: input.authMode,
      owner_user_id: input.ownerUserId ?? null,
      request_id: input.requestId,
      metadata: input.metadata ?? {},
    })

    if (!error) return

    if (isMissingTableError(error, LEGACY_ROUTE_USAGE_TABLE)) {
      console.warn(
        "Legacy route telemetry table is missing. Run latest migrations to track deprecation usage trends."
      )
      return
    }

    console.warn("Failed to record legacy route telemetry:", error)
  } catch (error) {
    if (isMissingTableError(error, LEGACY_ROUTE_USAGE_TABLE)) {
      console.warn(
        "Legacy route telemetry table is missing. Run latest migrations to track deprecation usage trends."
      )
      return
    }
    console.warn("Legacy route telemetry insert failed:", error)
  }
}
