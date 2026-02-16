import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { apiError } from "@/lib/memory-service/tools"
import { apiRateLimit, checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { authenticateApiKey, errorResponse, getApiKey } from "@/lib/sdk-api/runtime"
import { createAdminClient } from "@/lib/supabase/admin"

type ManagementMethod = "GET" | "POST" | "DELETE"

const DEFAULT_RETRY_AFTER_SECONDS = 60
const RATE_LIMIT_HEADERS = ["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]

export interface ManagementIdentity {
  userId: string
  apiKeyHash: string
  authMode: "api_key" | "session"
}

interface ResolveManagementIdentityOptions {
  endpoint: string
  request: NextRequest
  requestId: string
  method: ManagementMethod
  strictRateLimitMethods?: readonly ManagementMethod[]
  missingApiKeyMessage: string
  expiredApiKeyMessage: string
  apiKeyMetadataLookupLogContext: string
}

function rateLimitEnvelopeResponse(endpoint: string, requestId: string, source: NextResponse): NextResponse {
  const retryAfter = Number(source.headers.get("Retry-After") ?? String(DEFAULT_RETRY_AFTER_SECONDS))
  const response = errorResponse(
    endpoint,
    requestId,
    apiError({
      type: "rate_limit_error",
      code: "RATE_LIMITED",
      message: "Too many requests",
      status: 429,
      retryable: true,
      details: {
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : DEFAULT_RETRY_AFTER_SECONDS,
      },
    })
  )

  for (const headerName of RATE_LIMIT_HEADERS) {
    const value = source.headers.get(headerName)
    if (value) response.headers.set(headerName, value)
  }

  return response
}

function usesStrictRateLimit(method: ManagementMethod, strictMethods: readonly ManagementMethod[]): boolean {
  return strictMethods.includes(method)
}

async function resolveSessionIdentity(
  options: ResolveManagementIdentityOptions
): Promise<ManagementIdentity | NextResponse> {
  const auth = await authenticateRequest(options.request)
  if (!auth) {
    return errorResponse(
      options.endpoint,
      options.requestId,
      apiError({
        type: "auth_error",
        code: "UNAUTHORIZED",
        message: "Unauthorized",
        status: 401,
        retryable: false,
      })
    )
  }

  const strictMethods = options.strictRateLimitMethods ?? []
  const limiter = usesStrictRateLimit(options.method, strictMethods) ? strictRateLimit : apiRateLimit
  const rateLimited = await checkRateLimit(limiter, auth.userId)
  if (rateLimited) {
    return rateLimitEnvelopeResponse(options.endpoint, options.requestId, rateLimited)
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select("mcp_api_key_hash, mcp_api_key_expires_at")
    .eq("id", auth.userId)
    .single()

  if (error) {
    console.error(options.apiKeyMetadataLookupLogContext, error)
    return errorResponse(
      options.endpoint,
      options.requestId,
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
      options.endpoint,
      options.requestId,
      apiError({
        type: "validation_error",
        code: "MISSING_API_KEY",
        message: options.missingApiKeyMessage,
        status: 400,
        retryable: false,
      })
    )
  }

  if (!data.mcp_api_key_expires_at || new Date(data.mcp_api_key_expires_at).getTime() <= Date.now()) {
    return errorResponse(
      options.endpoint,
      options.requestId,
      apiError({
        type: "auth_error",
        code: "API_KEY_EXPIRED",
        message: options.expiredApiKeyMessage,
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

export async function resolveManagementIdentity(
  options: ResolveManagementIdentityOptions
): Promise<ManagementIdentity | NextResponse> {
  const apiKey = getApiKey(options.request)
  if (apiKey) {
    const auth = await authenticateApiKey(apiKey, options.endpoint, options.requestId)
    if (auth instanceof NextResponse) {
      return auth
    }

    const strictMethods = options.strictRateLimitMethods ?? []
    if (usesStrictRateLimit(options.method, strictMethods)) {
      const strictLimited = await checkRateLimit(strictRateLimit, auth.userId)
      if (strictLimited) {
        return rateLimitEnvelopeResponse(options.endpoint, options.requestId, strictLimited)
      }
    }

    return {
      userId: auth.userId,
      apiKeyHash: auth.apiKeyHash,
      authMode: "api_key",
    }
  }

  return resolveSessionIdentity(options)
}
