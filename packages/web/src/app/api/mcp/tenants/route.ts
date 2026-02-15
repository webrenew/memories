import { createClient as createTurso } from "@libsql/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import { setTimeout as delay } from "node:timers/promises"
import { authenticateRequest } from "@/lib/auth"
import { apiRateLimit, checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createDatabase, createDatabaseToken, initSchema } from "@/lib/turso"
import { getTursoOrgSlug } from "@/lib/env"

const TURSO_ORG = getTursoOrgSlug()
const LEGACY_ENDPOINT = "/api/mcp/tenants"
const SUCCESSOR_ENDPOINT = "/api/sdk/v1/management/tenants"
const LEGACY_SUNSET = "Tue, 30 Jun 2026 00:00:00 GMT"

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

async function getActiveApiKeyHash(
  userId: string
): Promise<{ apiKeyHash: string } | { error: NextResponse }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select("mcp_api_key_hash, mcp_api_key_expires_at")
    .eq("id", userId)
    .single()

  if (error) {
    console.error("Failed to load API key metadata for tenant management:", error)
    return {
      error: legacyJson(
        { error: "Failed to load API key metadata" },
        { status: 500 }
      ),
    }
  }

  if (!data?.mcp_api_key_hash) {
    return {
      error: legacyJson(
        { error: "Generate an API key before configuring tenant databases" },
        { status: 400 }
      ),
    }
  }

  if (!data.mcp_api_key_expires_at || new Date(data.mcp_api_key_expires_at).getTime() <= Date.now()) {
    return {
      error: legacyJson(
        { error: "API key is expired. Generate a new key before configuring tenant databases" },
        { status: 400 }
      ),
    }
  }

  return { apiKeyHash: data.mcp_api_key_hash as string }
}

export async function GET(request: Request): Promise<Response> {
  logDeprecatedAccess("GET")
  const auth = await authenticateRequest(request)
  if (!auth) {
    return legacyJson({ error: "Unauthorized" }, { status: 401 })
  }
  logDeprecatedAccess("GET", auth.userId)

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return applyLegacyHeaders(rateLimited)

  const keyState = await getActiveApiKeyHash(auth.userId)
  if ("error" in keyState) {
    return keyState.error
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("sdk_tenant_databases")
    .select("tenant_id, turso_db_url, turso_db_name, status, metadata, created_at, updated_at, last_verified_at")
    .eq("api_key_hash", keyState.apiKeyHash)
    .order("created_at", { ascending: true })

  if (error) {
    console.error("Failed to list tenant databases:", error)
    return legacyJson({ error: "Failed to list tenant databases" }, { status: 500 })
  }

  const rows = (data ?? []) as TenantRow[]
  return legacyJson({
    tenantDatabases: rows.map(mapTenantRow),
    count: rows.length,
  })
}

export async function POST(request: Request): Promise<Response> {
  logDeprecatedAccess("POST")
  const auth = await authenticateRequest(request)
  if (!auth) {
    return legacyJson({ error: "Unauthorized" }, { status: 401 })
  }
  logDeprecatedAccess("POST", auth.userId)

  const rateLimited = await checkRateLimit(strictRateLimit, auth.userId)
  if (rateLimited) return applyLegacyHeaders(rateLimited)

  const parsed = tenantCreateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid input"
    return legacyJson({ error: message }, { status: 400 })
  }

  const keyState = await getActiveApiKeyHash(auth.userId)
  if ("error" in keyState) {
    return keyState.error
  }

  const admin = createAdminClient()
  const { tenantId, mode, metadata } = parsed.data

  const { data: existing, error: existingError } = await admin
    .from("sdk_tenant_databases")
    .select("tenant_id, turso_db_url, turso_db_name, status, metadata, created_at, updated_at, last_verified_at")
    .eq("api_key_hash", keyState.apiKeyHash)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (existingError) {
    console.error("Failed to check existing tenant mapping:", existingError)
    return legacyJson({ error: "Failed to configure tenant database" }, { status: 500 })
  }

  if (mode === "provision" && existing?.status === "ready" && existing.turso_db_url) {
    return legacyJson({
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
        return legacyJson(
          { error: "tursoDbUrl must start with libsql:// when mode is attach" },
          { status: 400 }
        )
      }

      if (!attachToken || attachToken.length === 0) {
        return legacyJson(
          { error: "tursoDbToken is required when mode is attach" },
          { status: 400 }
        )
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

      // Give Turso a moment to finish provisioning before schema init.
      await delay(3000)
      await initSchema(url, token)

      tursoDbUrl = url
      tursoDbToken = token
      tursoDbName = db.name
    }
  } catch (error) {
    console.error("Tenant database setup failed:", error)
    return legacyJson({ error: "Failed to setup tenant database" }, { status: 500 })
  }

  const now = new Date().toISOString()
  const payload = {
    api_key_hash: keyState.apiKeyHash,
    tenant_id: tenantId,
    turso_db_url: tursoDbUrl,
    turso_db_token: tursoDbToken,
    turso_db_name: tursoDbName,
    status: "ready",
    metadata: metadata ?? {},
    created_by_user_id: auth.userId,
    updated_at: now,
    last_verified_at: now,
  }

  const { data: saved, error: saveError } = await admin
    .from("sdk_tenant_databases")
    .upsert(payload, { onConflict: "api_key_hash,tenant_id" })
    .select("tenant_id, turso_db_url, turso_db_name, status, metadata, created_at, updated_at, last_verified_at")
    .single()

  if (saveError || !saved) {
    console.error("Failed to save tenant database mapping:", saveError)
    return legacyJson({ error: "Failed to save tenant database mapping" }, { status: 500 })
  }

  return legacyJson({
    tenantDatabase: mapTenantRow(saved as TenantRow),
    provisioned: true,
    mode,
  })
}

export async function DELETE(request: Request): Promise<Response> {
  logDeprecatedAccess("DELETE")
  const auth = await authenticateRequest(request)
  if (!auth) {
    return legacyJson({ error: "Unauthorized" }, { status: 401 })
  }
  logDeprecatedAccess("DELETE", auth.userId)

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return applyLegacyHeaders(rateLimited)

  const url = new URL(request.url)
  const parsedTenantId = tenantIdSchema.safeParse(url.searchParams.get("tenantId"))
  if (!parsedTenantId.success) {
    return legacyJson({ error: "tenantId is required" }, { status: 400 })
  }

  const keyState = await getActiveApiKeyHash(auth.userId)
  if ("error" in keyState) {
    return keyState.error
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from("sdk_tenant_databases")
    .update({ status: "disabled", updated_at: now })
    .eq("api_key_hash", keyState.apiKeyHash)
    .eq("tenant_id", parsedTenantId.data)
    .select("tenant_id, status, updated_at")
    .maybeSingle()

  if (error) {
    console.error("Failed to disable tenant database mapping:", error)
    return legacyJson({ error: "Failed to disable tenant database mapping" }, { status: 500 })
  }

  if (!data) {
    return legacyJson({ error: "Tenant mapping not found" }, { status: 404 })
  }

  return legacyJson({
    ok: true,
    tenantId: data.tenant_id,
    status: data.status,
    updatedAt: data.updated_at,
  })
}
