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
  buildSdkTenantOwnerScopeKey,
  enforceSdkProjectProvisionLimit,
  recordGrowthProjectMeterEvent,
  resolveSdkProjectBillingContext,
  type SdkProjectBillingContext,
} from "@/lib/sdk-project-billing"
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
  ownerScopeKey: string,
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
    .eq("owner_scope_key", ownerScopeKey)
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
  ownerScopeKey: string
  tenantId: string
  ownerUserId?: string | null
  existingMetadata?: Record<string, unknown> | null
  billing?: SdkProjectBillingContext | null
}): Promise<void> {
  const { apiKeyHash, ownerScopeKey, tenantId, ownerUserId, existingMetadata, billing } = params

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
        owner_scope_key: ownerScopeKey,
        api_key_hash: apiKeyHash,
        mapping_source: "auto",
        tenant_id: tenantId,
        turso_db_url: url,
        turso_db_token: token,
        turso_db_name: db.name,
        status: "ready",
        metadata,
        created_by_user_id: ownerUserId ?? null,
        billing_owner_type: billing?.ownerType ?? "user",
        billing_owner_user_id: billing?.ownerUserId ?? ownerUserId ?? null,
        billing_org_id: billing?.orgId ?? null,
        stripe_customer_id: billing?.stripeCustomerId ?? null,
        updated_at: now,
        last_verified_at: now,
      },
      { onConflict: "owner_scope_key,tenant_id" }
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

  if (billing) {
    await recordGrowthProjectMeterEvent({
      admin,
      billing,
      apiKeyHash,
      tenantId,
    })
  }
}

async function resolveTenantOwnerScope(params: {
  admin: ReturnType<typeof createAdminClient>
  apiKeyHash: string
  ownerUserId?: string | null
}): Promise<{
  ownerScopeKey: string
  ownerUserId: string | null
  billingContext: SdkProjectBillingContext | null
}> {
  let ownerUserId = params.ownerUserId ?? null

  if (!ownerUserId) {
    const { data: keyOwnerData } = await params.admin
      .from("users")
      .select("id")
      .eq("mcp_api_key_hash", params.apiKeyHash)
      .maybeSingle()
    ownerUserId = (keyOwnerData?.id as string | undefined) ?? null
  }

  let billingContext: SdkProjectBillingContext | null = null
  if (ownerUserId) {
    billingContext = await resolveSdkProjectBillingContext(params.admin, ownerUserId)
  }

  const ownerScopeKey =
    billingContext?.ownerScopeKey ??
    buildSdkTenantOwnerScopeKey({
      ownerType: "user",
      ownerUserId: ownerUserId ?? params.apiKeyHash,
      orgId: null,
    })

  return { ownerScopeKey, ownerUserId, billingContext }
}

export async function resolveTenantTurso(
  apiKeyHash: string,
  tenantId: string,
  options: { ownerUserId?: string | null; autoProvision?: boolean } = {}
): Promise<TursoClient> {
  const admin = createAdminClient()
  const ownerScope = await resolveTenantOwnerScope({
    admin,
    apiKeyHash,
    ownerUserId: options.ownerUserId ?? null,
  })
  let mapping = await readTenantMapping(ownerScope.ownerScopeKey, tenantId)
  let billingContext: SdkProjectBillingContext | null = ownerScope.billingContext

  const canAutoProvision =
    (options.autoProvision ?? true) &&
    shouldAutoProvisionTenantDatabases() &&
    hasTursoPlatformApiToken()

  if (
    canAutoProvision &&
    (!mapping || mapping.status === "disabled" || mapping.status === "error" || !mapping.turso_db_url || !mapping.turso_db_token)
  ) {
    if (ownerScope.ownerUserId) {
      const billingCheck = await enforceSdkProjectProvisionLimit({
        admin,
        userId: ownerScope.ownerUserId,
      })

      if (!billingCheck.ok) {
        throw new ToolExecutionError(
          apiError({
            type: "auth_error",
            code: billingCheck.code,
            message: billingCheck.message,
            status: billingCheck.status,
            retryable: false,
          }),
          { rpcCode: -32003 }
        )
      }

      billingContext = billingCheck.billing
    }

    try {
      await autoProvisionTenantDatabase({
        apiKeyHash,
        ownerScopeKey: ownerScope.ownerScopeKey,
        tenantId,
        ownerUserId: ownerScope.ownerUserId,
        existingMetadata: mapping?.metadata ?? null,
        billing: billingContext,
      })
      mapping = await readTenantMapping(ownerScope.ownerScopeKey, tenantId)
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
