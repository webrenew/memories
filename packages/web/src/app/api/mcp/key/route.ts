import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import {
  createUserApiKey,
  listUserApiKeys,
  revokeUserApiKeys,
} from "@/lib/mcp-api-key-store"

const MAX_KEY_TTL_DAYS = 365
const MAX_KEY_TTL_MS = MAX_KEY_TTL_DAYS * 24 * 60 * 60 * 1000
const MIN_KEY_TTL_MS = 60 * 1000
const LEGACY_ENDPOINT = "/api/mcp/key"
const SUCCESSOR_ENDPOINT = "/api/sdk/v1/management/keys"
const LEGACY_SUNSET = "Tue, 30 Jun 2026 00:00:00 GMT"

function applyLegacyHeaders(response: NextResponse): NextResponse {
  response.headers.set("Deprecation", "true")
  response.headers.set("Sunset", LEGACY_SUNSET)
  response.headers.set("Link", `<${SUCCESSOR_ENDPOINT}>; rel="successor-version"`)
  return response
}

function legacyJson(body: unknown, init?: { status?: number }): NextResponse {
  return applyLegacyHeaders(NextResponse.json(body, init))
}

function logDeprecatedAccess(method: "GET" | "POST" | "DELETE", userId?: string): void {
  const userSegment = userId ? ` (user:${userId})` : ""
  console.warn(`[DEPRECATED_ENDPOINT] ${LEGACY_ENDPOINT} ${method}${userSegment} -> use ${SUCCESSOR_ENDPOINT}`)
}

function parseRequestedExpiry(rawExpiry: unknown): { expiresAt: string } | { error: string } {
  if (typeof rawExpiry !== "string" || rawExpiry.trim().length === 0) {
    return { error: "expiresAt is required" }
  }

  const parsed = new Date(rawExpiry)
  if (Number.isNaN(parsed.getTime())) {
    return { error: "expiresAt must be a valid ISO datetime" }
  }

  const now = Date.now()
  if (parsed.getTime() <= now + MIN_KEY_TTL_MS) {
    return { error: "expiresAt must be at least 1 minute in the future" }
  }

  if (parsed.getTime() > now + MAX_KEY_TTL_MS) {
    return { error: `expiresAt cannot be more than ${MAX_KEY_TTL_DAYS} days in the future` }
  }

  return { expiresAt: parsed.toISOString() }
}

// GET - Get current API key
export async function GET(): Promise<Response> {
  logDeprecatedAccess("GET")
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return legacyJson({ error: "Unauthorized" }, { status: 401 })
  }
  logDeprecatedAccess("GET", user.id)

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return applyLegacyHeaders(rateLimited)

  const admin = createAdminClient()
  let keys
  try {
    keys = await listUserApiKeys(admin, user.id)
  } catch (error) {
    console.error("Failed to load API key status metadata:", error)
    return legacyJson({ error: "Failed to load API key status metadata" }, { status: 500 })
  }

  if (!keys || keys.length === 0) {
    return legacyJson({ hasKey: false, keys: [] })
  }

  const primary = keys.find((key) => !key.isExpired) ?? keys[0]
  const activeKeyCount = keys.filter((key) => !key.isExpired).length

  return legacyJson({
    hasKey: true, 
    keyCount: keys.length,
    activeKeyCount,
    keyPreview: primary?.keyPreview ?? null,
    createdAt: primary?.createdAt ?? null,
    expiresAt: primary?.expiresAt ?? null,
    isExpired: primary?.isExpired ?? false,
    keys,
  })
}

// POST - Generate new API key
export async function POST(request: Request): Promise<Response> {
  logDeprecatedAccess("POST")
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return legacyJson({ error: "Unauthorized" }, { status: 401 })
  }
  logDeprecatedAccess("POST", user.id)

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return applyLegacyHeaders(rateLimited)

  let body: { expiresAt?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    // Body is validated below.
  }

  const expiry = parseRequestedExpiry(body.expiresAt)
  if ("error" in expiry) {
    return legacyJson({ error: expiry.error }, { status: 400 })
  }

  const admin = createAdminClient()
  let created
  try {
    created = await createUserApiKey(admin, {
      userId: user.id,
      expiresAt: expiry.expiresAt,
    })
  } catch (error) {
    console.error("Failed to create API key:", error)
    return legacyJson({ error: "Failed to generate key" }, { status: 500 })
  }

  // Return the full key (only time it's shown)
  return legacyJson({
    apiKey: created.apiKey,
    keyId: created.keyId,
    keyPreview: created.keyPreview,
    createdAt: created.createdAt,
    expiresAt: expiry.expiresAt,
    message: "Save this key - it won't be shown again",
  })
}

// DELETE - Revoke API key
export async function DELETE(request: Request): Promise<Response> {
  logDeprecatedAccess("DELETE")
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return legacyJson({ error: "Unauthorized" }, { status: 401 })
  }
  logDeprecatedAccess("DELETE", user.id)

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return applyLegacyHeaders(rateLimited)

  const keyId = new URL(request.url).searchParams.get("keyId")?.trim() || null

  const admin = createAdminClient()
  let revokedCount = 0
  try {
    const revoked = await revokeUserApiKeys(admin, {
      userId: user.id,
      keyId: keyId ?? undefined,
    })
    revokedCount = revoked.revokedCount
  } catch (error) {
    console.error("Failed to revoke API key:", error)
    return legacyJson({ error: "Failed to revoke key" }, { status: 500 })
  }

  if (keyId && revokedCount === 0) {
    return legacyJson({ error: "API key not found" }, { status: 404 })
  }

  return legacyJson({
    ok: true,
    revokedCount,
    revokedKeyId: keyId,
  })
}
