import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import {
  formatMcpApiKeyPreview,
  generateMcpApiKey,
  getMcpApiKeyLast4,
  getMcpApiKeyPrefix,
  hashMcpApiKey,
} from "@/lib/mcp-api-key"

const MAX_KEY_TTL_DAYS = 365
const MAX_KEY_TTL_MS = MAX_KEY_TTL_DAYS * 24 * 60 * 60 * 1000
const MIN_KEY_TTL_MS = 60 * 1000
const LEGACY_ENDPOINT = "/api/mcp/key"
const SUCCESSOR_ENDPOINT = "/api/sdk/v1/management/keys"
const LEGACY_SUNSET = "Tue, 30 Jun 2026 00:00:00 GMT"

interface TenantMappingRow {
  tenant_id: string
  turso_db_url: string
  turso_db_token: string
  turso_db_name: string | null
  status: string
  metadata: Record<string, unknown> | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string
  last_verified_at: string | null
}

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

async function cloneTenantMappingsForKeyRotation(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  previousApiKeyHash: string,
  nextApiKeyHash: string
): Promise<{ copied: number }> {
  if (!previousApiKeyHash || previousApiKeyHash === nextApiKeyHash) {
    return { copied: 0 }
  }

  const { data, error } = await admin
    .from("sdk_tenant_databases")
    .select("tenant_id, turso_db_url, turso_db_token, turso_db_name, status, metadata, created_by_user_id, created_at, updated_at, last_verified_at")
    .eq("api_key_hash", previousApiKeyHash)

  if (error) {
    throw new Error(`Failed to load tenant mappings for key rotation: ${error.message}`)
  }

  const rows = (data ?? []) as TenantMappingRow[]
  if (rows.length === 0) {
    return { copied: 0 }
  }

  const now = new Date().toISOString()
  const payload = rows.map((row) => ({
    api_key_hash: nextApiKeyHash,
    tenant_id: row.tenant_id,
    turso_db_url: row.turso_db_url,
    turso_db_token: row.turso_db_token,
    turso_db_name: row.turso_db_name,
    status: row.status,
    metadata: row.metadata ?? {},
    created_by_user_id: row.created_by_user_id ?? userId,
    created_at: row.created_at ?? now,
    updated_at: now,
    last_verified_at: row.last_verified_at ?? now,
  }))

  const { error: upsertError } = await admin
    .from("sdk_tenant_databases")
    .upsert(payload, { onConflict: "api_key_hash,tenant_id" })

  if (upsertError) {
    throw new Error(`Failed to copy tenant mappings for key rotation: ${upsertError.message}`)
  }

  return { copied: rows.length }
}

async function cleanupOldTenantMappingsForKeyRotation(
  admin: ReturnType<typeof createAdminClient>,
  previousApiKeyHash: string
): Promise<void> {
  if (!previousApiKeyHash) return

  const { error } = await admin
    .from("sdk_tenant_databases")
    .delete()
    .eq("api_key_hash", previousApiKeyHash)

  if (error) {
    throw new Error(`Failed to cleanup old tenant mappings: ${error.message}`)
  }
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
  const { data: userData, error: userDataError } = await admin
    .from("users")
    .select("mcp_api_key_hash, mcp_api_key_prefix, mcp_api_key_last4, mcp_api_key_created_at, mcp_api_key_expires_at")
    .eq("id", user.id)
    .single()

  if (userDataError) {
    console.error("Failed to load API key status metadata:", userDataError)
    return legacyJson({ error: "Failed to load API key status metadata" }, { status: 500 })
  }

  if (!userData?.mcp_api_key_hash) {
    return legacyJson({ hasKey: false })
  }

  const keyPreview = formatMcpApiKeyPreview(userData.mcp_api_key_prefix, userData.mcp_api_key_last4)
  const expiresAt = userData.mcp_api_key_expires_at as string | null
  const isExpired = !expiresAt || new Date(expiresAt).getTime() <= Date.now()

  return legacyJson({ 
    hasKey: true, 
    keyPreview,
    createdAt: userData.mcp_api_key_created_at,
    expiresAt,
    isExpired,
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

  const apiKey = generateMcpApiKey()
  const apiKeyHash = hashMcpApiKey(apiKey)
  const apiKeyPrefix = getMcpApiKeyPrefix(apiKey)
  const apiKeyLast4 = getMcpApiKeyLast4(apiKey)
  const createdAt = new Date().toISOString()

  const admin = createAdminClient()
  const { data: existingUser, error: existingUserError } = await admin
    .from("users")
    .select("mcp_api_key_hash")
    .eq("id", user.id)
    .single()

  if (existingUserError) {
    console.error("Failed to load existing API key metadata:", existingUserError)
    return legacyJson({ error: "Failed to load existing API key metadata" }, { status: 500 })
  }

  const previousApiKeyHash = existingUser?.mcp_api_key_hash as string | null

  let copiedTenantMappings = 0
  try {
    const { copied } = await cloneTenantMappingsForKeyRotation(admin, user.id, previousApiKeyHash ?? "", apiKeyHash)
    copiedTenantMappings = copied
  } catch (error) {
    console.error("Failed to remap tenant mappings for key rotation:", error)
    return legacyJson({ error: "Failed to rotate key due to tenant mapping remap failure" }, { status: 500 })
  }

  const { error } = await admin
    .from("users")
    .update({
      mcp_api_key: null,
      mcp_api_key_hash: apiKeyHash,
      mcp_api_key_prefix: apiKeyPrefix,
      mcp_api_key_last4: apiKeyLast4,
      mcp_api_key_created_at: createdAt,
      mcp_api_key_expires_at: expiry.expiresAt,
    })
    .eq("id", user.id)

  if (error) {
    if (copiedTenantMappings > 0) {
      try {
        await cleanupOldTenantMappingsForKeyRotation(admin, apiKeyHash)
      } catch (rollbackError) {
        console.error("Failed to rollback tenant mappings after key rotation failure:", rollbackError)
      }
    }

    return legacyJson({ error: "Failed to generate key" }, { status: 500 })
  }

  if (previousApiKeyHash) {
    try {
      await cleanupOldTenantMappingsForKeyRotation(admin, previousApiKeyHash)
    } catch (cleanupError) {
      // Non-fatal: new key is already active and mapped.
      console.error("Failed to cleanup old tenant mappings after key rotation:", cleanupError)
    }
  }

  // Return the full key (only time it's shown)
  return legacyJson({ 
    apiKey,
    keyPreview: formatMcpApiKeyPreview(apiKeyPrefix, apiKeyLast4),
    createdAt,
    expiresAt: expiry.expiresAt,
    message: "Save this key - it won't be shown again",
  })
}

// DELETE - Revoke API key
export async function DELETE(): Promise<Response> {
  logDeprecatedAccess("DELETE")
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return legacyJson({ error: "Unauthorized" }, { status: 401 })
  }
  logDeprecatedAccess("DELETE", user.id)

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return applyLegacyHeaders(rateLimited)

  const admin = createAdminClient()
  const { data: existingUser, error: existingUserError } = await admin
    .from("users")
    .select("mcp_api_key_hash")
    .eq("id", user.id)
    .single()

  if (existingUserError) {
    console.error("Failed to load existing API key metadata for revoke:", existingUserError)
    return legacyJson({ error: "Failed to load existing API key metadata" }, { status: 500 })
  }

  const previousApiKeyHash = existingUser?.mcp_api_key_hash as string | null

  const { error } = await admin
    .from("users")
    .update({
      mcp_api_key: null,
      mcp_api_key_hash: null,
      mcp_api_key_prefix: null,
      mcp_api_key_last4: null,
      mcp_api_key_created_at: null,
      mcp_api_key_expires_at: null,
    })
    .eq("id", user.id)

  if (error) {
    return legacyJson({ error: "Failed to revoke key" }, { status: 500 })
  }

  if (previousApiKeyHash) {
    try {
      await cleanupOldTenantMappingsForKeyRotation(admin, previousApiKeyHash)
    } catch (cleanupError) {
      // Non-fatal: the API key has already been revoked.
      console.error("Failed to cleanup tenant mappings after key revoke:", cleanupError)
    }
  }

  return legacyJson({ ok: true })
}
