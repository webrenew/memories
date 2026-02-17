import { DELETE as overridesDelete, GET as overridesGet, POST as overridesPost } from "@/app/api/sdk/v1/management/tenant-overrides/route"
import { type LegacyRouteAuthMode, recordLegacyRouteUsageEvent } from "@/lib/legacy-route-telemetry"
import {
  applyLegacyTenantHeaders,
  copySelectedHeaders,
  LEGACY_MANAGEMENT_TENANTS_ENDPOINT,
  type LegacyMethod,
  LEGACY_TENANT_PASSTHROUGH_HEADERS,
  LEGACY_TENANT_SUCCESSOR_ENDPOINT,
  resolveLegacyRouteAuthMode,
  type SdkEnvelopeLike,
} from "@/lib/sdk-api/legacy-tenant-route-policy"
import { legacyErrorResponse, successResponse } from "@/lib/sdk-api/runtime"
import { NextRequest, NextResponse } from "next/server"

function logDeprecatedAccess(method: LegacyMethod, status: number, authMode: LegacyRouteAuthMode): void {
  console.warn(
    `[DEPRECATED_ENDPOINT] ${LEGACY_MANAGEMENT_TENANTS_ENDPOINT} ${method} status=${status} authMode=${authMode} -> use ${LEGACY_TENANT_SUCCESSOR_ENDPOINT}`
  )
}

async function wrapLegacyResponse(
  requestId: string,
  method: LegacyMethod,
  request: Request,
  response: Response
): Promise<NextResponse> {
  const payload = await response.json().catch(() => null)
  const authMode = resolveLegacyRouteAuthMode(request)

  let wrapped: NextResponse
  if (payload && typeof payload === "object") {
    const envelope = payload as SdkEnvelopeLike
    if (envelope.ok === true) {
      wrapped = successResponse(LEGACY_MANAGEMENT_TENANTS_ENDPOINT, requestId, envelope.data, response.status)
    } else if (envelope.ok === false) {
      const status = response.status
      const message =
        envelope.error?.message ??
        (status >= 500
          ? "Legacy endpoint failed due to an internal error"
          : `Legacy endpoint failed with status ${status}`)
      wrapped = legacyErrorResponse(
        LEGACY_MANAGEMENT_TENANTS_ENDPOINT,
        requestId,
        status,
        message,
        envelope.error?.code ?? "LEGACY_TENANT_ROUTE_ERROR",
        envelope.error?.details
      )
    } else if (response.ok) {
      wrapped = successResponse(LEGACY_MANAGEMENT_TENANTS_ENDPOINT, requestId, payload, response.status)
    } else {
      wrapped = legacyErrorResponse(
        LEGACY_MANAGEMENT_TENANTS_ENDPOINT,
        requestId,
        response.status,
        `Legacy endpoint failed with status ${response.status}`,
        "LEGACY_TENANT_ROUTE_ERROR",
        payload as Record<string, unknown>
      )
    }
  } else if (response.ok) {
    wrapped = successResponse(LEGACY_MANAGEMENT_TENANTS_ENDPOINT, requestId, null, response.status)
  } else {
    wrapped = legacyErrorResponse(
      LEGACY_MANAGEMENT_TENANTS_ENDPOINT,
      requestId,
      response.status,
      `Legacy endpoint failed with status ${response.status}`,
      "LEGACY_TENANT_ROUTE_ERROR"
    )
  }

  copySelectedHeaders(response.headers, wrapped.headers, LEGACY_TENANT_PASSTHROUGH_HEADERS)
  applyLegacyTenantHeaders(wrapped)

  await recordLegacyRouteUsageEvent({
    route: LEGACY_MANAGEMENT_TENANTS_ENDPOINT,
    successorRoute: LEGACY_TENANT_SUCCESSOR_ENDPOINT,
    method,
    status: wrapped.status,
    requestId,
    authMode,
    metadata: {
      wrappedEndpoint: LEGACY_TENANT_SUCCESSOR_ENDPOINT,
    },
  })
  logDeprecatedAccess(method, wrapped.status, authMode)

  return wrapped
}

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  const response = await overridesGet(request as NextRequest)
  return wrapLegacyResponse(requestId, "GET", request, response)
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  const response = await overridesPost(request as NextRequest)
  return wrapLegacyResponse(requestId, "POST", request, response)
}

export async function DELETE(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  const response = await overridesDelete(request as NextRequest)
  return wrapLegacyResponse(requestId, "DELETE", request, response)
}
