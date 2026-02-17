import { type LegacyRouteAuthMode } from "@/lib/legacy-route-telemetry"
import { NextResponse } from "next/server"

export type LegacyMethod = "GET" | "POST" | "DELETE"

export interface SdkEnvelopeLike {
  ok?: boolean
  data?: unknown
  error?: {
    message?: string
    code?: string
    details?: Record<string, unknown>
  } | null
}

export function resolveLegacyRouteAuthMode(request: Request): LegacyRouteAuthMode {
  const authorization = request.headers.get("authorization")
  if (authorization?.startsWith("Bearer ")) {
    return "api_key"
  }
  return "session"
}

export const LEGACY_MCP_TENANTS_ENDPOINT = "/api/mcp/tenants"
export const LEGACY_MANAGEMENT_TENANTS_ENDPOINT = "/api/sdk/v1/management/tenants"
export const LEGACY_TENANT_SUCCESSOR_ENDPOINT = "/api/sdk/v1/management/tenant-overrides"
export const LEGACY_TENANT_SUNSET = "Tue, 30 Jun 2026 00:00:00 GMT"
export const LEGACY_TENANT_WARNING =
  `299 - "Deprecated API: migrate to ${LEGACY_TENANT_SUCCESSOR_ENDPOINT} before ${LEGACY_TENANT_SUNSET}"`

export const LEGACY_TENANT_PASSTHROUGH_HEADERS = [
  "Retry-After",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
] as const

export function applyLegacyTenantHeaders(response: NextResponse): NextResponse {
  response.headers.set("Deprecation", "true")
  response.headers.set("Sunset", LEGACY_TENANT_SUNSET)
  response.headers.set("Link", `<${LEGACY_TENANT_SUCCESSOR_ENDPOINT}>; rel="successor-version"`)
  response.headers.set("Warning", LEGACY_TENANT_WARNING)
  return response
}

export function copySelectedHeaders(
  source: Headers,
  target: Headers,
  headerNames: readonly string[]
): void {
  for (const headerName of headerNames) {
    const value = source.get(headerName)
    if (value) {
      target.set(headerName, value)
    }
  }
}
