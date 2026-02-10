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
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  const { data: userData } = await admin
    .from("users")
    .select("mcp_api_key_hash, mcp_api_key_prefix, mcp_api_key_last4, mcp_api_key_created_at, mcp_api_key_expires_at")
    .eq("id", user.id)
    .single()

  if (!userData?.mcp_api_key_hash) {
    return NextResponse.json({ hasKey: false })
  }

  const keyPreview = formatMcpApiKeyPreview(userData.mcp_api_key_prefix, userData.mcp_api_key_last4)
  const expiresAt = userData.mcp_api_key_expires_at as string | null
  const isExpired = !expiresAt || new Date(expiresAt).getTime() <= Date.now()

  return NextResponse.json({ 
    hasKey: true, 
    keyPreview,
    createdAt: userData.mcp_api_key_created_at,
    expiresAt,
    isExpired,
  })
}

// POST - Generate new API key
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  let body: { expiresAt?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    // Body is validated below.
  }

  const expiry = parseRequestedExpiry(body.expiresAt)
  if ("error" in expiry) {
    return NextResponse.json({ error: expiry.error }, { status: 400 })
  }

  const apiKey = generateMcpApiKey()
  const apiKeyHash = hashMcpApiKey(apiKey)
  const apiKeyPrefix = getMcpApiKeyPrefix(apiKey)
  const apiKeyLast4 = getMcpApiKeyLast4(apiKey)
  const createdAt = new Date().toISOString()

  const admin = createAdminClient()
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
    return NextResponse.json({ error: "Failed to generate key" }, { status: 500 })
  }

  // Return the full key (only time it's shown)
  return NextResponse.json({ 
    apiKey,
    keyPreview: formatMcpApiKeyPreview(apiKeyPrefix, apiKeyLast4),
    createdAt,
    expiresAt: expiry.expiresAt,
    message: "Save this key - it won't be shown again",
  })
}

// DELETE - Revoke API key
export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
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
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
