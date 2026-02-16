import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { hasTursoPlatformApiToken, shouldAutoProvisionTenants } from "@/lib/env"
import { apiError } from "@/lib/memory-service/tools"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import {
  authenticateApiKey,
  errorResponse,
  getApiKey,
  invalidRequestResponse,
  successResponse,
} from "@/lib/sdk-api/runtime"
import {
  buildSdkTenantOwnerScopeKey,
  enforceSdkProjectProvisionLimit,
  resolveSdkProjectBillingContext,
} from "@/lib/sdk-project-billing"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeTenantMappingSource } from "@/lib/tenant-routing"

const ENDPOINT = "/api/sdk/v1/management/tenant-routing/effective"

const tenantIdSchema = z.string().trim().min(1, "tenantId is required").max(120, "tenantId is too long")

type TenantRoutingRow = {
  tenant_id: string
  turso_db_url: string | null
  turso_db_token: string | null
  turso_db_name: string | null
  status: string
  mapping_source: "auto" | "override" | null
  metadata: Record<string, unknown> | null
  updated_at: string
  last_verified_at: string | null
}

type ManagementIdentity = {
  userId: string
  apiKeyHash: string
  authMode: "api_key" | "session"
}

async function resolveOwnerScopeContext(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const billing = await resolveSdkProjectBillingContext(admin, userId)

  return {
    billing,
    ownerScopeKey:
      billing?.ownerScopeKey ??
      buildSdkTenantOwnerScopeKey({
        ownerType: "user",
        ownerUserId: userId,
        orgId: null,
      }),
  }
}

function rateLimitEnvelopeResponse(requestId: string, source: NextResponse): NextResponse {
  const retryAfter = Number(source.headers.get("Retry-After") ?? "60")
  const response = errorResponse(
    ENDPOINT,
    requestId,
    apiError({
      type: "rate_limit_error",
      code: "RATE_LIMITED",
      message: "Too many requests",
      status: 429,
      retryable: true,
      details: {
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 60,
      },
    })
  )

  const rateHeaders = ["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]
  for (const headerName of rateHeaders) {
    const value = source.headers.get(headerName)
    if (value) response.headers.set(headerName, value)
  }

  return response
}

async function resolveSessionIdentity(request: NextRequest, requestId: string): Promise<ManagementIdentity | NextResponse> {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "auth_error",
        code: "UNAUTHORIZED",
        message: "Unauthorized",
        status: 401,
        retryable: false,
      })
    )
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) {
    return rateLimitEnvelopeResponse(requestId, rateLimited)
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select("mcp_api_key_hash, mcp_api_key_expires_at")
    .eq("id", auth.userId)
    .single()

  if (error) {
    console.error("Failed to load API key metadata for tenant routing debug:", error)
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "API_KEY_METADATA_LOOKUP_FAILED",
        message: "Failed to load API key metadata",
        status: 500,
        retryable: true,
      })
    )
  }

  if (!data?.mcp_api_key_hash) {
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "validation_error",
        code: "MISSING_API_KEY",
        message: "Generate an API key before inspecting tenant routing",
        status: 400,
        retryable: false,
      })
    )
  }

  if (!data.mcp_api_key_expires_at || new Date(data.mcp_api_key_expires_at).getTime() <= Date.now()) {
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "auth_error",
        code: "API_KEY_EXPIRED",
        message: "API key expired. Generate a new key before inspecting tenant routing.",
        status: 401,
        retryable: false,
      })
    )
  }

  return {
    userId: auth.userId,
    apiKeyHash: data.mcp_api_key_hash as string,
    authMode: "session",
  }
}

async function resolveManagementIdentity(
  request: NextRequest,
  requestId: string
): Promise<ManagementIdentity | NextResponse> {
  const apiKey = getApiKey(request)
  if (apiKey) {
    const auth = await authenticateApiKey(apiKey, ENDPOINT, requestId)
    if (auth instanceof NextResponse) {
      return auth
    }

    return {
      userId: auth.userId,
      apiKeyHash: auth.apiKeyHash,
      authMode: "api_key",
    }
  }

  return resolveSessionIdentity(request, requestId)
}

function buildDecision(params: {
  hasMapping: boolean
  mappingReady: boolean
  mappingStatus: string | null
  mappingSource: "auto" | "override" | null
  missingCredentials: boolean
  autoProvisionEnabled: boolean
  hasPlatformToken: boolean
  billingEligible: boolean | null
  billingCode: string | null
  billingMessage: string | null
}): { code: string; reason: string } {
  if (params.mappingReady) {
    return {
      code: "MAPPING_READY",
      reason: "Tenant routes to a ready mapping.",
    }
  }

  if (!params.hasMapping) {
    if (params.autoProvisionEnabled && params.hasPlatformToken && params.billingEligible === true) {
      return {
        code: "AUTO_PROVISION_ELIGIBLE",
        reason: "No mapping exists. Runtime will auto-provision on first tenant request.",
      }
    }

    if (params.autoProvisionEnabled && params.hasPlatformToken && params.billingEligible === false) {
      return {
        code: "AUTO_PROVISION_BLOCKED",
        reason: `No mapping exists and auto-provision is blocked (${params.billingCode ?? "BILLING_ERROR"}): ${params.billingMessage ?? "Unknown billing error"}`,
      }
    }

    if (!params.autoProvisionEnabled) {
      return {
        code: "NO_MAPPING",
        reason: "No mapping exists and auto-provisioning is disabled.",
      }
    }

    return {
      code: "NO_MAPPING",
      reason: "No mapping exists and Turso platform token is unavailable.",
    }
  }

  const source = params.mappingSource ?? "override"
  if (params.autoProvisionEnabled && params.hasPlatformToken && params.billingEligible === true) {
    return {
      code: "AUTO_PROVISION_ELIGIBLE",
      reason: params.missingCredentials
        ? `Existing ${source} mapping is missing credentials; runtime can auto-provision replacement credentials.`
        : `Existing ${source} mapping is not ready (status=${params.mappingStatus ?? "unknown"}); runtime can auto-provision a replacement mapping.`,
    }
  }

  return {
    code: "MAPPING_NOT_READY",
    reason: params.missingCredentials
      ? `Existing ${source} mapping is missing credentials.`
      : `Existing ${source} mapping is not ready (status=${params.mappingStatus ?? "unknown"}).`,
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()
  const identity = await resolveManagementIdentity(request, requestId)
  if (identity instanceof NextResponse) return identity

  const tenantIdParse = tenantIdSchema.safeParse(new URL(request.url).searchParams.get("tenantId"))
  if (!tenantIdParse.success) {
    return invalidRequestResponse(ENDPOINT, requestId, tenantIdParse.error.issues[0]?.message ?? "tenantId is required")
  }

  const tenantId = tenantIdParse.data
  const admin = createAdminClient()
  const ownerScope = await resolveOwnerScopeContext(admin, identity.userId)

  const { data, error } = await admin
    .from("sdk_tenant_databases")
    .select(
      "tenant_id, turso_db_url, turso_db_token, turso_db_name, status, mapping_source, metadata, updated_at, last_verified_at"
    )
    .eq("owner_scope_key", ownerScope.ownerScopeKey)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (error) {
    console.error("Failed to load effective tenant routing:", error)
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "TENANT_ROUTING_EFFECTIVE_LOOKUP_FAILED",
        message: "Failed to resolve effective tenant routing",
        status: 500,
        retryable: true,
      })
    )
  }

  const mapping = (data as TenantRoutingRow | null) ?? null
  const mappingSource = mapping
    ? normalizeTenantMappingSource({
        source: mapping.mapping_source,
        metadata: mapping.metadata,
      })
    : null
  const hasMapping = Boolean(mapping)
  const hasCredentials = Boolean(mapping?.turso_db_url && mapping?.turso_db_token)
  const mappingReady = Boolean(mapping && mapping.status === "ready" && hasCredentials)

  const autoProvisionEnabled = shouldAutoProvisionTenants()
  const hasPlatformToken = hasTursoPlatformApiToken()

  let billingEligible: boolean | null = null
  let billingCode: string | null = null
  let billingMessage: string | null = null

  if (!mappingReady && autoProvisionEnabled && hasPlatformToken) {
    const billingState = await enforceSdkProjectProvisionLimit({
      admin,
      userId: identity.userId,
    })

    billingEligible = billingState.ok
    if (!billingState.ok) {
      billingCode = billingState.code
      billingMessage = billingState.message
    }
  }

  const decision = buildDecision({
    hasMapping,
    mappingReady,
    mappingStatus: mapping?.status ?? null,
    mappingSource,
    missingCredentials: hasMapping && !hasCredentials,
    autoProvisionEnabled,
    hasPlatformToken,
    billingEligible,
    billingCode,
    billingMessage,
  })

  return successResponse(ENDPOINT, requestId, {
    tenantId,
    resolvedTarget: {
      kind: mappingReady ? "tenant_database" : "none",
      tursoDbUrl: mappingReady ? mapping?.turso_db_url : null,
      tursoDbName: mappingReady ? mapping?.turso_db_name ?? null : null,
    },
    mapping: {
      exists: hasMapping,
      status: mapping?.status ?? null,
      source: mappingSource,
      hasCredentials,
      metadata: mapping?.metadata ?? {},
      updatedAt: mapping?.updated_at ?? null,
      lastVerifiedAt: mapping?.last_verified_at ?? null,
    },
    ownerScope: {
      key: ownerScope.ownerScopeKey,
      ownerType: ownerScope.billing?.ownerType ?? "user",
      ownerUserId: ownerScope.billing?.ownerUserId ?? identity.userId,
      orgId: ownerScope.billing?.orgId ?? null,
      plan: ownerScope.billing?.plan ?? null,
      stripeCustomerId: ownerScope.billing?.stripeCustomerId ?? null,
      authMode: identity.authMode,
      apiKeyHashPrefix: identity.apiKeyHash.slice(0, 8),
    },
    decision: {
      ...decision,
      autoProvisionEnabled,
      hasPlatformToken,
      billingEligible,
      billingCode,
      billingMessage,
    },
  })
}
