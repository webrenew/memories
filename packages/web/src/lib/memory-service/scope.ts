import { createAdminClient } from "@/lib/supabase/admin"
import { createDatabase, createDatabaseToken, initSchema } from "@/lib/turso"
import { createClient as createTurso } from "@libsql/client"
import { setTimeout as delay } from "node:timers/promises"
import {
  getTursoOrgSlug,
  hasTursoPlatformApiToken,
  shouldAutoProvisionTenants,
} from "@/lib/env"
import {
  apiError,
  type TursoClient,
  ToolExecutionError,
} from "./types"

// Re-export from extracted modules
export {
  workingMemoryExpiresAt,
  parseTenantId,
  parseUserId,
  parseMemoryLayer,
  buildLayerFilterClause,
  buildNotExpiredFilter,
  buildUserScopeFilter,
} from "./scope-parsers"

export {
  ensureMemoryUserIdSchema,
  type EnsureMemoryUserIdSchemaOptions,
} from "./scope-schema"

// ─── Tenant Resolution ────────────────────────────────────────────────────────

function shouldAutoProvisionTenantDatabases(): boolean {
  return shouldAutoProvisionTenants()
}

async function readTenantMapping(
  apiKeyHash: string,
  tenantId: string
): Promise<{
  turso_db_url: string | null
  turso_db_token: string | null
  status: string
  metadata: Record<string, unknown> | null
} | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("sdk_tenant_databases")
    .select("turso_db_url, turso_db_token, status, metadata")
    .eq("api_key_hash", apiKeyHash)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (error) {
    throw new ToolExecutionError(
      apiError({
        type: "internal_error",
        code: "TENANT_MAPPING_LOOKUP_FAILED",
        message: "Failed to lookup tenant database mapping",
        status: 500,
        retryable: true,
        details: { tenant_id: tenantId, error: error.message },
      }),
      { rpcCode: -32000 }
    )
  }

  if (!data) {
    return null
  }

  return {
    turso_db_url: data.turso_db_url,
    turso_db_token: data.turso_db_token,
    status: data.status,
    metadata:
      data.metadata && typeof data.metadata === "object"
        ? (data.metadata as Record<string, unknown>)
        : {},
  }
}

async function autoProvisionTenantDatabase(params: {
  apiKeyHash: string
  tenantId: string
  ownerUserId?: string | null
  existingMetadata?: Record<string, unknown> | null
}): Promise<void> {
  const { apiKeyHash, tenantId, ownerUserId, existingMetadata } = params

  if (!hasTursoPlatformApiToken()) {
    return
  }

  const tursoOrg = getTursoOrgSlug()
  const db = await createDatabase(tursoOrg)
  const token = await createDatabaseToken(tursoOrg, db.name)
  const url = `libsql://${db.hostname}`

  await delay(3000)
  await initSchema(url, token)

  const now = new Date().toISOString()
  const metadata = {
    ...(existingMetadata ?? {}),
    provisionedBy: "sdk_auto",
    provisionedAt: now,
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("sdk_tenant_databases")
    .upsert(
      {
        api_key_hash: apiKeyHash,
        tenant_id: tenantId,
        turso_db_url: url,
        turso_db_token: token,
        turso_db_name: db.name,
        status: "ready",
        metadata,
        created_by_user_id: ownerUserId ?? null,
        updated_at: now,
        last_verified_at: now,
      },
      { onConflict: "api_key_hash,tenant_id" }
    )

  if (error) {
    throw new ToolExecutionError(
      apiError({
        type: "internal_error",
        code: "TENANT_AUTO_PROVISION_FAILED",
        message: "Failed to save auto-provisioned tenant database mapping",
        status: 500,
        retryable: true,
        details: { tenant_id: tenantId, error: error.message },
      }),
      { rpcCode: -32000 }
    )
  }
}

export async function resolveTenantTurso(
  apiKeyHash: string,
  tenantId: string,
  options: { ownerUserId?: string | null; autoProvision?: boolean } = {}
): Promise<TursoClient> {
  let mapping = await readTenantMapping(apiKeyHash, tenantId)

  const canAutoProvision =
    (options.autoProvision ?? true) &&
    shouldAutoProvisionTenantDatabases() &&
    hasTursoPlatformApiToken()

  if (
    canAutoProvision &&
    (!mapping || mapping.status === "disabled" || mapping.status === "error" || !mapping.turso_db_url || !mapping.turso_db_token)
  ) {
    try {
      await autoProvisionTenantDatabase({
        apiKeyHash,
        tenantId,
        ownerUserId: options.ownerUserId,
        existingMetadata: mapping?.metadata ?? null,
      })
      mapping = await readTenantMapping(apiKeyHash, tenantId)
      console.info(`[SDK_AUTO_PROVISION] Tenant database ready for tenant_id=${tenantId}`)
    } catch (error) {
      console.error("[SDK_AUTO_PROVISION] Failed to auto-provision tenant database:", error)
    }
  }

  if (!mapping) {
    throw new ToolExecutionError(
      apiError({
        type: "not_found_error",
        code: "TENANT_DATABASE_NOT_CONFIGURED",
        message: `No tenant database configured for tenant_id: ${tenantId}`,
        status: 404,
        retryable: false,
        details: { tenant_id: tenantId },
      }),
      { rpcCode: -32004 }
    )
  }

  if (mapping.status !== "ready") {
    throw new ToolExecutionError(
      apiError({
        type: "tool_error",
        code: "TENANT_DATABASE_NOT_READY",
        message: `Tenant database is not ready (status: ${mapping.status})`,
        status: 409,
        retryable: true,
        details: { tenant_id: tenantId, status: mapping.status },
      }),
      { rpcCode: -32009 }
    )
  }

  if (!mapping.turso_db_url || !mapping.turso_db_token) {
    throw new ToolExecutionError(
      apiError({
        type: "not_found_error",
        code: "TENANT_DATABASE_CREDENTIALS_MISSING",
        message: `Tenant database credentials are missing for tenant_id: ${tenantId}`,
        status: 404,
        retryable: false,
        details: { tenant_id: tenantId },
      }),
      { rpcCode: -32004 }
    )
  }

  return createTurso({
    url: mapping.turso_db_url,
    authToken: mapping.turso_db_token,
  })
}
