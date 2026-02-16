import { createClient as createTurso } from "@libsql/client"
import { setTimeout as delay } from "node:timers/promises"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { getTursoOrgSlug } from "@/lib/env"
import { apiError } from "@/lib/memory-service/tools"
import { apiRateLimit, checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import {
  authenticateApiKey,
  errorResponse,
  getApiKey,
  invalidRequestResponse,
  successResponse,
} from "@/lib/sdk-api/runtime"
import {
  countActiveProjectsForBillingContext,
  enforceSdkProjectProvisionLimit,
  recordGrowthProjectMeterEvent,
} from "@/lib/sdk-project-billing"
import { createAdminClient } from "@/lib/supabase/admin"
import { createDatabase, createDatabaseToken, initSchema } from "@/lib/turso"

const ENDPOINT = "/api/sdk/v1/management/tenant-overrides"
const TURSO_ORG = getTursoOrgSlug()

const tenantIdSchema = z.string().trim().min(1, "tenantId is required").max(120, "tenantId is too long")

const tenantCreateSchema = z.object({
  tenantId: tenantIdSchema,
  mode: z.enum(["provision", "attach"]).default("provision"),
  tursoDbUrl: z.string().trim().optional(),
  tursoDbToken: z.string().trim().optional(),
  tursoDbName: z.string().trim().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

type TenantRow = {
  tenant_id: string
  turso_db_url: string
  turso_db_name: string | null
  status: string
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  last_verified_at: string | null
}

type ManagementIdentity = {
  userId: string
  apiKeyHash: string
  authMode: "api_key" | "session"
}

function mapTenantRow(row: TenantRow) {
  return {
    tenantId: row.tenant_id,
    tursoDbUrl: row.turso_db_url,
    tursoDbName: row.turso_db_name,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at,
  }
}

function errorTypeForStatus(status: number): "auth_error" | "validation_error" | "rate_limit_error" | "internal_error" | "not_found_error" {
  if (status === 400) return "validation_error"
  if (status === 401 || status === 403) return "auth_error"
  if (status === 404) return "not_found_error"
  if (status === 429) return "rate_limit_error"
  return "internal_error"
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

async function resolveSessionIdentity(request: NextRequest, requestId: string, method: "GET" | "POST" | "DELETE"): Promise<ManagementIdentity | NextResponse> {
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

  const limiter = method === "POST" ? strictRateLimit : apiRateLimit
  const rateLimited = await checkRateLimit(limiter, auth.userId)
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
    console.error("Failed to load API key metadata for tenant override management:", error)
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
        message: "Generate an API key before configuring tenant overrides",
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
        message: "API key expired. Generate a new key before configuring tenant overrides.",
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
  requestId: string,
  method: "GET" | "POST" | "DELETE"
): Promise<ManagementIdentity | NextResponse> {
  const apiKey = getApiKey(request)
  if (apiKey) {
    const auth = await authenticateApiKey(apiKey, ENDPOINT, requestId)
    if (auth instanceof NextResponse) {
      return auth
    }

    if (method === "POST") {
      const strictLimited = await checkRateLimit(strictRateLimit, auth.userId)
      if (strictLimited) {
        return rateLimitEnvelopeResponse(requestId, strictLimited)
      }
    }

    return {
      userId: auth.userId,
      apiKeyHash: auth.apiKeyHash,
      authMode: "api_key",
    }
  }

  return resolveSessionIdentity(request, requestId, method)
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()
  const identity = await resolveManagementIdentity(request, requestId, "GET")
  if (identity instanceof NextResponse) return identity

  const admin = createAdminClient()
  const billingState = await enforceSdkProjectProvisionLimit({
    admin,
    userId: identity.userId,
    apiKeyHash: identity.apiKeyHash,
  })

  const billingSummary =
    billingState.ok
      ? {
          plan: billingState.billing.plan,
          includedProjects: billingState.billing.includedProjects,
          overageUsdPerProject: billingState.billing.overageUsdPerProject,
          maxProjectsPerMonth: billingState.billing.maxProjectsPerMonth,
          activeProjects: billingState.activeProjectCount,
        }
      : null

  const { data, error } = await admin
    .from("sdk_tenant_databases")
    .select("tenant_id, turso_db_url, turso_db_name, status, metadata, created_at, updated_at, last_verified_at")
    .eq("api_key_hash", identity.apiKeyHash)
    .order("created_at", { ascending: true })

  if (error) {
    console.error("Failed to list tenant overrides:", error)
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "TENANT_OVERRIDE_LIST_FAILED",
        message: "Failed to list tenant overrides",
        status: 500,
        retryable: true,
      })
    )
  }

  const rows = (data ?? []) as TenantRow[]
  return successResponse(ENDPOINT, requestId, {
    tenantDatabases: rows.map(mapTenantRow),
    count: rows.length,
    billing: billingSummary,
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()
  const identity = await resolveManagementIdentity(request, requestId, "POST")
  if (identity instanceof NextResponse) return identity

  const parsed = tenantCreateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return invalidRequestResponse(
      ENDPOINT,
      requestId,
      parsed.error.issues[0]?.message ?? "Invalid request payload"
    )
  }

  const admin = createAdminClient()
  const billingState = await enforceSdkProjectProvisionLimit({
    admin,
    userId: identity.userId,
    apiKeyHash: identity.apiKeyHash,
  })

  if (!billingState.ok) {
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: errorTypeForStatus(billingState.status),
        code: billingState.code,
        message: billingState.message,
        status: billingState.status,
        retryable: billingState.status === 429 || billingState.status >= 500,
      })
    )
  }

  const { tenantId, mode, metadata } = parsed.data
  const { data: existing, error: existingError } = await admin
    .from("sdk_tenant_databases")
    .select("tenant_id, turso_db_url, turso_db_name, status, metadata, created_at, updated_at, last_verified_at")
    .eq("api_key_hash", identity.apiKeyHash)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (existingError) {
    console.error("Failed to check existing tenant override:", existingError)
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "TENANT_OVERRIDE_LOOKUP_FAILED",
        message: "Failed to configure tenant override",
        status: 500,
        retryable: true,
      })
    )
  }

  if (mode === "provision" && existing?.status === "ready" && existing.turso_db_url) {
    return successResponse(ENDPOINT, requestId, {
      tenantDatabase: mapTenantRow(existing as TenantRow),
      provisioned: false,
      mode,
    })
  }

  let tursoDbUrl: string
  let tursoDbToken: string
  let tursoDbName: string | null = parsed.data.tursoDbName ?? null

  try {
    if (mode === "attach") {
      const attachUrl = parsed.data.tursoDbUrl
      const attachToken = parsed.data.tursoDbToken
      if (!attachUrl?.startsWith("libsql://")) {
        return invalidRequestResponse(
          ENDPOINT,
          requestId,
          "tursoDbUrl must start with libsql:// when mode is attach"
        )
      }

      if (!attachToken || attachToken.length === 0) {
        return invalidRequestResponse(ENDPOINT, requestId, "tursoDbToken is required when mode is attach")
      }

      const attachedClient = createTurso({
        url: attachUrl,
        authToken: attachToken,
      })
      await attachedClient.execute("SELECT 1")

      tursoDbUrl = attachUrl
      tursoDbToken = attachToken
      if (!tursoDbName) {
        tursoDbName = attachUrl.replace("libsql://", "")
      }
    } else {
      const db = await createDatabase(TURSO_ORG)
      const token = await createDatabaseToken(TURSO_ORG, db.name)
      const url = `libsql://${db.hostname}`

      await delay(3000)
      await initSchema(url, token)

      tursoDbUrl = url
      tursoDbToken = token
      tursoDbName = db.name
    }
  } catch (error) {
    console.error("Tenant override setup failed:", error)
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "TENANT_OVERRIDE_SETUP_FAILED",
        message: "Failed to setup tenant database override",
        status: 500,
        retryable: true,
      })
    )
  }

  const now = new Date().toISOString()
  const payload = {
    api_key_hash: identity.apiKeyHash,
    tenant_id: tenantId,
    turso_db_url: tursoDbUrl,
    turso_db_token: tursoDbToken,
    turso_db_name: tursoDbName,
    status: "ready",
    metadata: metadata ?? {},
    created_by_user_id: identity.userId,
    billing_owner_type: billingState.billing.ownerType,
    billing_owner_user_id: billingState.billing.ownerUserId,
    billing_org_id: billingState.billing.orgId,
    stripe_customer_id: billingState.billing.stripeCustomerId,
    updated_at: now,
    last_verified_at: now,
  }

  const { data: saved, error: saveError } = await admin
    .from("sdk_tenant_databases")
    .upsert(payload, { onConflict: "api_key_hash,tenant_id" })
    .select("tenant_id, turso_db_url, turso_db_name, status, metadata, created_at, updated_at, last_verified_at")
    .single()

  if (saveError || !saved) {
    console.error("Failed to save tenant override mapping:", saveError)
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "TENANT_OVERRIDE_SAVE_FAILED",
        message: "Failed to save tenant database override",
        status: 500,
        retryable: true,
      })
    )
  }

  await recordGrowthProjectMeterEvent({
    admin,
    billing: billingState.billing,
    apiKeyHash: identity.apiKeyHash,
    tenantId,
  })

  const activeProjects = await countActiveProjectsForBillingContext(
    admin,
    identity.apiKeyHash,
    billingState.billing.stripeCustomerId
  )

  return successResponse(ENDPOINT, requestId, {
    tenantDatabase: mapTenantRow(saved as TenantRow),
    provisioned: true,
    mode,
    billing: {
      plan: billingState.billing.plan,
      includedProjects: billingState.billing.includedProjects,
      overageUsdPerProject: billingState.billing.overageUsdPerProject,
      maxProjectsPerMonth: billingState.billing.maxProjectsPerMonth,
      activeProjects,
    },
  })
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()
  const identity = await resolveManagementIdentity(request, requestId, "DELETE")
  if (identity instanceof NextResponse) return identity

  const url = new URL(request.url)
  const parsedTenantId = tenantIdSchema.safeParse(url.searchParams.get("tenantId"))
  if (!parsedTenantId.success) {
    return invalidRequestResponse(ENDPOINT, requestId, "tenantId is required")
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from("sdk_tenant_databases")
    .update({ status: "disabled", updated_at: now })
    .eq("api_key_hash", identity.apiKeyHash)
    .eq("tenant_id", parsedTenantId.data)
    .select("tenant_id, status, updated_at")
    .maybeSingle()

  if (error) {
    console.error("Failed to disable tenant override:", error)
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "TENANT_OVERRIDE_DISABLE_FAILED",
        message: "Failed to disable tenant override",
        status: 500,
        retryable: true,
      })
    )
  }

  if (!data) {
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "not_found_error",
        code: "TENANT_OVERRIDE_NOT_FOUND",
        message: "Tenant override not found",
        status: 404,
        retryable: false,
      })
    )
  }

  return successResponse(ENDPOINT, requestId, {
    ok: true,
    tenantId: data.tenant_id,
    status: data.status,
    updatedAt: data.updated_at,
  })
}
