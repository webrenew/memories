import type { createAdminClient } from "@/lib/supabase/admin"
import {
  formatMcpApiKeyPreview,
  generateMcpApiKey,
  getMcpApiKeyLast4,
  getMcpApiKeyPrefix,
  hashMcpApiKey,
} from "@/lib/mcp-api-key"

type AdminClient = ReturnType<typeof createAdminClient>

interface LegacyUserKeyRow {
  id: string
  email: string | null
  mcp_api_key_hash: string | null
  mcp_api_key_prefix: string | null
  mcp_api_key_last4: string | null
  mcp_api_key_created_at: string | null
  mcp_api_key_expires_at: string | null
}

interface ApiKeyRow {
  id: string
  user_id: string
  api_key_hash: string
  api_key_prefix: string
  api_key_last4: string
  created_at: string
  expires_at: string
  revoked_at: string | null
}

export interface UserApiKeyRecord {
  id: string
  keyPreview: string | null
  createdAt: string
  expiresAt: string
  isExpired: boolean
}

export interface ApiKeyOwnerRecord {
  userId: string
  email: string | null
  expiresAt: string | null
}

export interface CreatedUserApiKey {
  keyId: string
  apiKey: string
  keyPreview: string | null
  createdAt: string
  expiresAt: string
}

function isMissingApiKeysTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : ""
  if (code === "42P01") return true

  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : ""
  return message.includes("mcp_api_keys") || message.includes("Unexpected table: mcp_api_keys")
}

function toApiKeyRecord(row: Pick<ApiKeyRow, "id" | "api_key_prefix" | "api_key_last4" | "created_at" | "expires_at">): UserApiKeyRecord {
  return {
    id: row.id,
    keyPreview: formatMcpApiKeyPreview(row.api_key_prefix, row.api_key_last4),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    isExpired: new Date(row.expires_at).getTime() <= Date.now(),
  }
}

async function getLegacyUserKey(admin: AdminClient, userId: string): Promise<LegacyUserKeyRow | null> {
  const { data, error } = await admin
    .from("users")
    .select(
      "id, email, mcp_api_key_hash, mcp_api_key_prefix, mcp_api_key_last4, mcp_api_key_created_at, mcp_api_key_expires_at"
    )
    .eq("id", userId)
    .single()

  if (error) {
    throw new Error(`Failed to load API key metadata: ${error.message}`)
  }

  return (data as LegacyUserKeyRow | null) ?? null
}

async function clearLegacyUserKey(admin: AdminClient, userId: string): Promise<void> {
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
    .eq("id", userId)

  if (error) {
    throw new Error(`Failed to clear legacy API key metadata: ${error.message}`)
  }
}

async function upsertLegacyUserKey(
  admin: AdminClient,
  params: {
    userId: string
    apiKeyHash: string
    apiKeyPrefix: string
    apiKeyLast4: string
    createdAt: string
    expiresAt: string
  }
): Promise<void> {
  const { error } = await admin
    .from("users")
    .update({
      mcp_api_key: null,
      mcp_api_key_hash: params.apiKeyHash,
      mcp_api_key_prefix: params.apiKeyPrefix,
      mcp_api_key_last4: params.apiKeyLast4,
      mcp_api_key_created_at: params.createdAt,
      mcp_api_key_expires_at: params.expiresAt,
    })
    .eq("id", params.userId)

  if (error) {
    throw new Error(`Failed to sync legacy API key metadata: ${error.message}`)
  }
}

export async function listUserApiKeys(admin: AdminClient, userId: string): Promise<UserApiKeyRecord[]> {
  const { data, error } = await admin
    .from("mcp_api_keys")
    .select("id, api_key_prefix, api_key_last4, created_at, expires_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    if (!isMissingApiKeysTableError(error)) {
      throw new Error(`Failed to list API keys: ${error.message}`)
    }

    const legacy = await getLegacyUserKey(admin, userId)
    if (!legacy?.mcp_api_key_hash || !legacy.mcp_api_key_created_at || !legacy.mcp_api_key_expires_at) {
      return []
    }

    return [
      {
        id: `legacy:${legacy.mcp_api_key_hash}`,
        keyPreview: formatMcpApiKeyPreview(legacy.mcp_api_key_prefix, legacy.mcp_api_key_last4),
        createdAt: legacy.mcp_api_key_created_at,
        expiresAt: legacy.mcp_api_key_expires_at,
        isExpired: new Date(legacy.mcp_api_key_expires_at).getTime() <= Date.now(),
      },
    ]
  }

  return ((data as ApiKeyRow[] | null) ?? [])
    .filter((row) => !row.revoked_at)
    .map((row) => toApiKeyRecord(row))
}

async function syncLegacyPrimaryApiKey(admin: AdminClient, userId: string): Promise<void> {
  const nowIso = new Date().toISOString()
  const { data, error } = await admin
    .from("mcp_api_keys")
    .select("api_key_hash, api_key_prefix, api_key_last4, created_at, expires_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("expires_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)

  if (error) {
    if (isMissingApiKeysTableError(error)) {
      return
    }
    throw new Error(`Failed to sync primary API key metadata: ${error.message}`)
  }

  const primary = (data as Array<{
    api_key_hash: string
    api_key_prefix: string
    api_key_last4: string
    created_at: string
    expires_at: string
  }> | null)?.[0]

  if (!primary) {
    await clearLegacyUserKey(admin, userId)
    return
  }

  await upsertLegacyUserKey(admin, {
    userId,
    apiKeyHash: primary.api_key_hash,
    apiKeyPrefix: primary.api_key_prefix,
    apiKeyLast4: primary.api_key_last4,
    createdAt: primary.created_at,
    expiresAt: primary.expires_at,
  })
}

export async function createUserApiKey(
  admin: AdminClient,
  params: { userId: string; expiresAt: string }
): Promise<CreatedUserApiKey> {
  const apiKey = generateMcpApiKey()
  const apiKeyHash = hashMcpApiKey(apiKey)
  const apiKeyPrefix = getMcpApiKeyPrefix(apiKey)
  const apiKeyLast4 = getMcpApiKeyLast4(apiKey)
  const createdAt = new Date().toISOString()

  const { data, error } = await admin
    .from("mcp_api_keys")
    .insert({
      user_id: params.userId,
      api_key_hash: apiKeyHash,
      api_key_prefix: apiKeyPrefix,
      api_key_last4: apiKeyLast4,
      created_at: createdAt,
      expires_at: params.expiresAt,
      created_via: "dashboard",
    })
    .select("id")
    .single()

  if (error) {
    if (!isMissingApiKeysTableError(error)) {
      throw new Error(`Failed to create API key: ${error.message}`)
    }

    await upsertLegacyUserKey(admin, {
      userId: params.userId,
      apiKeyHash,
      apiKeyPrefix,
      apiKeyLast4,
      createdAt,
      expiresAt: params.expiresAt,
    })

    return {
      keyId: `legacy:${apiKeyHash}`,
      apiKey,
      keyPreview: formatMcpApiKeyPreview(apiKeyPrefix, apiKeyLast4),
      createdAt,
      expiresAt: params.expiresAt,
    }
  }

  await syncLegacyPrimaryApiKey(admin, params.userId)

  return {
    keyId: String((data as { id?: string } | null)?.id ?? ""),
    apiKey,
    keyPreview: formatMcpApiKeyPreview(apiKeyPrefix, apiKeyLast4),
    createdAt,
    expiresAt: params.expiresAt,
  }
}

export async function revokeUserApiKeys(
  admin: AdminClient,
  params: { userId: string; keyId?: string }
): Promise<{ revokedCount: number }> {
  const nowIso = new Date().toISOString()

  if (params.keyId) {
    if (params.keyId.startsWith("legacy:")) {
      await clearLegacyUserKey(admin, params.userId)
      return { revokedCount: 1 }
    }

    const { data, error } = await admin
      .from("mcp_api_keys")
      .update({ revoked_at: nowIso })
      .eq("user_id", params.userId)
      .eq("id", params.keyId)
      .is("revoked_at", null)
      .select("id")

    if (error) {
      if (!isMissingApiKeysTableError(error)) {
        throw new Error(`Failed to revoke API key: ${error.message}`)
      }
      return { revokedCount: 0 }
    }

    await syncLegacyPrimaryApiKey(admin, params.userId)
    return { revokedCount: Array.isArray(data) ? data.length : 0 }
  }

  const { data, error } = await admin
    .from("mcp_api_keys")
    .update({ revoked_at: nowIso })
    .eq("user_id", params.userId)
    .is("revoked_at", null)
    .select("id")

  if (error) {
    if (!isMissingApiKeysTableError(error)) {
      throw new Error(`Failed to revoke API keys: ${error.message}`)
    }
    await clearLegacyUserKey(admin, params.userId)
    return { revokedCount: 1 }
  }

  await syncLegacyPrimaryApiKey(admin, params.userId)
  return { revokedCount: Array.isArray(data) ? data.length : 0 }
}

export async function resolveApiKeyOwnerByHash(
  admin: AdminClient,
  apiKeyHash: string
): Promise<ApiKeyOwnerRecord | null> {
  const { data: legacyUser, error: legacyError } = await admin
    .from("users")
    .select("id, email, mcp_api_key_expires_at")
    .eq("mcp_api_key_hash", apiKeyHash)
    .single()

  if (!legacyError && legacyUser?.id) {
    return {
      userId: String(legacyUser.id),
      email: (legacyUser as { email?: string | null }).email ?? null,
      expiresAt: (legacyUser as { mcp_api_key_expires_at?: string | null }).mcp_api_key_expires_at ?? null,
    }
  }

  const { data: keyRow, error: keyLookupError } = await admin
    .from("mcp_api_keys")
    .select("user_id, expires_at, revoked_at")
    .eq("api_key_hash", apiKeyHash)
    .single()

  if (keyLookupError || !keyRow || (keyRow as { revoked_at?: string | null }).revoked_at) {
    return null
  }

  const userId = String((keyRow as { user_id: string }).user_id)
  const { data: user, error: userError } = await admin
    .from("users")
    .select("id, email")
    .eq("id", userId)
    .single()

  if (userError || !user?.id) {
    return null
  }

  return {
    userId,
    email: (user as { email?: string | null }).email ?? null,
    expiresAt: String((keyRow as { expires_at: string }).expires_at),
  }
}
