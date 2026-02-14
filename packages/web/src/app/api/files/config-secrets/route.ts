import { NextResponse } from "next/server"
import { z } from "zod"
import { createHash } from "node:crypto"
import { authenticateRequest } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { apiRateLimit, checkPreAuthApiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { resolveWorkspaceContext } from "@/lib/workspace"

const scopeSchema = z.enum(["global", "project"])
const integrationSchema = z.string().trim().min(1).max(80)
const configPathSchema = z.string().trim().min(1).max(260)
const secretKeySchema = z.string().trim().min(1).max(160)
const secretValueSchema = z.string().min(1).max(16_384)

const getQuerySchema = z.object({
  scope: scopeSchema.default("global"),
  project_id: z.string().trim().min(1).optional(),
  integration: integrationSchema,
  config_path: configPathSchema,
})

const upsertEntrySchema = z.object({
  scope: scopeSchema.default("global"),
  project_id: z.string().trim().min(1).optional(),
  integration: integrationSchema,
  config_path: configPathSchema,
  secrets: z.record(secretKeySchema, secretValueSchema).refine((record) => Object.keys(record).length > 0, {
    message: "secrets must include at least one key",
  }),
})

const upsertBodySchema = z.object({
  entries: z.array(upsertEntrySchema).min(1).max(200),
})

interface SecretRefRow {
  id: string
  secret_key: string
  vault_secret_id: string
  vault_secret_name: string
}

interface WorkspaceTarget {
  target_owner_type: "user" | "organization"
  target_user_id: string | null
  target_org_id: string | null
  ownerSegment: string
}

type ConfigScope = z.infer<typeof scopeSchema>

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12)
}

function canManageWorkspaceSecrets(workspace: Awaited<ReturnType<typeof resolveWorkspaceContext>>): boolean {
  if (!workspace) return false
  if (workspace.ownerType === "user") return true
  return workspace.orgRole === "owner" || workspace.orgRole === "admin"
}

function resolveWorkspaceTarget(
  workspace: NonNullable<Awaited<ReturnType<typeof resolveWorkspaceContext>>>,
  userId: string,
): WorkspaceTarget | null {
  if (workspace.ownerType === "organization") {
    if (!workspace.orgId) return null
    return {
      target_owner_type: "organization",
      target_user_id: null,
      target_org_id: workspace.orgId,
      ownerSegment: `org_${workspace.orgId}`,
    }
  }

  return {
    target_owner_type: "user",
    target_user_id: userId,
    target_org_id: null,
    ownerSegment: `user_${userId}`,
  }
}

function resolveProjectId(scope: ConfigScope, projectId: string | undefined): { projectId: string | null; error?: string } {
  if (scope === "global") {
    if (projectId && projectId.trim().length > 0) {
      return { projectId: null, error: "project_id is only allowed for project scope" }
    }
    return { projectId: null }
  }

  const normalized = projectId?.trim()
  if (!normalized) {
    return { projectId: null, error: "project_id is required for project scope" }
  }
  return { projectId: normalized }
}

function applyProjectIdFilter<T extends { eq: (column: string, value: string) => T; is: (column: string, value: null) => T }>(
  query: T,
  projectId: string | null,
): T {
  if (projectId === null) {
    return query.is("project_id", null)
  }
  return query.eq("project_id", projectId)
}

function isMissingSchemaError(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return (
    message.includes("integration_secret_refs")
      || message.includes("files_vault_")
      || message.includes("function")
      || message.includes("does not exist")
      || message.includes("vault")
  )
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim()
    if (message.length > 0) return message
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return fallback
}

function extractUuid(data: unknown): string | null {
  if (typeof data === "string" && data.length > 0) return data
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "string") return data[0]
  if (typeof data === "object" && data !== null && "id" in data) {
    const id = (data as { id?: unknown }).id
    if (typeof id === "string" && id.length > 0) return id
  }
  return null
}

function buildVaultSecretName(params: {
  target: WorkspaceTarget
  scope: "global" | "project"
  projectId: string | null
  integration: string
  configPath: string
  secretKey: string
}): string {
  const projectPart = params.scope === "project" && params.projectId ? shortHash(params.projectId) : "global"
  const integrationPart = params.integration.replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 24)
  const pathHash = shortHash(params.configPath)
  const keyHash = shortHash(params.secretKey)
  const base = `memories.files.${params.target.ownerSegment}.${params.scope}.${projectPart}.${integrationPart}.${pathHash}.${keyHash}`
  return base.slice(0, 180)
}

function buildVaultSecretDescription(params: {
  scope: "global" | "project"
  projectId: string | null
  integration: string
  configPath: string
  secretKey: string
}): string {
  const projectText = params.scope === "project" && params.projectId ? ` project=${params.projectId}` : ""
  return `memories config secret; integration=${params.integration}; path=${params.configPath}; key=${params.secretKey}; scope=${params.scope}${projectText}`
}

export async function GET(request: Request) {
  const preAuthRateLimited = await checkPreAuthApiRateLimit(request)
  if (preAuthRateLimited) return preAuthRateLimited

  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const parsedQuery = getQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()))
  if (!parsedQuery.success) {
    return NextResponse.json({ error: parsedQuery.error.issues[0]?.message ?? "Invalid query" }, { status: 400 })
  }

  const projectScope = resolveProjectId(parsedQuery.data.scope, parsedQuery.data.project_id)
  if (projectScope.error) {
    return NextResponse.json({ error: projectScope.error }, { status: 400 })
  }
  const projectId = projectScope.projectId

  const admin = createAdminClient()
  const workspace = await resolveWorkspaceContext(admin, auth.userId)
  if (!workspace) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (workspace.plan !== "pro") {
    return NextResponse.json({ error: "Scoped Vault-backed config sync is a Pro feature." }, { status: 403 })
  }

  if (!canManageWorkspaceSecrets(workspace)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const target = resolveWorkspaceTarget(workspace, auth.userId)
  if (!target) {
    return NextResponse.json({ error: "Failed to resolve workspace target" }, { status: 500 })
  }

  let query = admin
    .from("integration_secret_refs")
    .select("secret_key, vault_secret_id")
    .eq("target_owner_type", target.target_owner_type)
    .eq("scope", parsedQuery.data.scope)
    .eq("integration", parsedQuery.data.integration)
    .eq("config_path", parsedQuery.data.config_path)
  query = applyProjectIdFilter(query, projectId)

  query = target.target_owner_type === "organization"
    ? query.eq("target_org_id", target.target_org_id).is("target_user_id", null)
    : query.eq("target_user_id", target.target_user_id).is("target_org_id", null)

  const refsResult = await query
  if (refsResult.error) {
    if (isMissingSchemaError(refsResult.error)) {
      return NextResponse.json(
        { error: "Config secret schema is missing. Run the latest database migration." },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: toErrorMessage(refsResult.error, "Failed to load config secret refs") },
      { status: 500 },
    )
  }

  const rows = (refsResult.data ?? []) as Array<{ secret_key: string; vault_secret_id: string }>
  if (rows.length === 0) {
    return NextResponse.json({ error: "No config secrets found for requested scope/path." }, { status: 404 })
  }

  const secrets: Record<string, string> = {}
  for (const row of rows) {
    const vaultResult = await admin.rpc("files_vault_read_secret", {
      p_secret_id: row.vault_secret_id,
    })
    if (vaultResult.error) {
      if (isMissingSchemaError(vaultResult.error)) {
        return NextResponse.json(
          { error: "Vault helper functions are missing. Run the latest database migration." },
          { status: 503 },
        )
      }
      return NextResponse.json(
        { error: toErrorMessage(vaultResult.error, "Failed to read config secret from Vault") },
        { status: 500 },
      )
    }

    if (typeof vaultResult.data === "string" && vaultResult.data.length > 0) {
      secrets[row.secret_key] = vaultResult.data
    }
  }

  return NextResponse.json({
    scope: parsedQuery.data.scope,
    project_id: projectId,
    integration: parsedQuery.data.integration,
    config_path: parsedQuery.data.config_path,
    secrets,
    count: Object.keys(secrets).length,
  })
}

export async function POST(request: Request) {
  const preAuthRateLimited = await checkPreAuthApiRateLimit(request)
  if (preAuthRateLimited) return preAuthRateLimited

  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const parsedBody = upsertBodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
  }

  const admin = createAdminClient()
  const workspace = await resolveWorkspaceContext(admin, auth.userId)
  if (!workspace) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (workspace.plan !== "pro") {
    return NextResponse.json({ error: "Scoped Vault-backed config sync is a Pro feature." }, { status: 403 })
  }

  if (!canManageWorkspaceSecrets(workspace)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const target = resolveWorkspaceTarget(workspace, auth.userId)
  if (!target) {
    return NextResponse.json({ error: "Failed to resolve workspace target" }, { status: 500 })
  }

  let created = 0
  let updated = 0

  for (const entry of parsedBody.data.entries) {
    const projectScope = resolveProjectId(entry.scope, entry.project_id)
    if (projectScope.error) {
      return NextResponse.json({ error: projectScope.error }, { status: 400 })
    }
    const projectId = projectScope.projectId

    const secretKeys = Object.keys(entry.secrets)
    if (secretKeys.length === 0) continue

    let existingQuery = admin
      .from("integration_secret_refs")
      .select("id, secret_key, vault_secret_id, vault_secret_name")
      .eq("target_owner_type", target.target_owner_type)
      .eq("scope", entry.scope)
      .eq("integration", entry.integration)
      .eq("config_path", entry.config_path)
      .in("secret_key", secretKeys)
    existingQuery = applyProjectIdFilter(existingQuery, projectId)

    existingQuery = target.target_owner_type === "organization"
      ? existingQuery.eq("target_org_id", target.target_org_id).is("target_user_id", null)
      : existingQuery.eq("target_user_id", target.target_user_id).is("target_org_id", null)

    const existingResult = await existingQuery
    if (existingResult.error) {
      if (isMissingSchemaError(existingResult.error)) {
        return NextResponse.json(
          { error: "Config secret schema is missing. Run the latest database migration." },
          { status: 503 },
        )
      }
      return NextResponse.json(
        { error: toErrorMessage(existingResult.error, "Failed to load existing config secret refs") },
        { status: 500 },
      )
    }

    const existingByKey = new Map<string, SecretRefRow>(
      ((existingResult.data ?? []) as SecretRefRow[]).map((row) => [row.secret_key, row]),
    )

    for (const [secretKey, secretValue] of Object.entries(entry.secrets)) {
      const existing = existingByKey.get(secretKey)
      const description = buildVaultSecretDescription({
        scope: entry.scope,
        projectId,
        integration: entry.integration,
        configPath: entry.config_path,
        secretKey,
      })

      if (existing) {
        const updateSecretResult = await admin.rpc("files_vault_update_secret", {
          p_secret_id: existing.vault_secret_id,
          p_secret: secretValue,
          p_name: existing.vault_secret_name,
          p_description: description,
        })

        if (updateSecretResult.error) {
          if (isMissingSchemaError(updateSecretResult.error)) {
            return NextResponse.json(
              { error: "Vault helper functions are missing. Run the latest database migration." },
              { status: 503 },
            )
          }
          return NextResponse.json(
            { error: toErrorMessage(updateSecretResult.error, "Failed to update config secret in Vault") },
            { status: 500 },
          )
        }

        const updateRefResult = await admin
          .from("integration_secret_refs")
          .update({
            updated_by_user_id: auth.userId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)

        if (updateRefResult.error) {
          return NextResponse.json(
            { error: toErrorMessage(updateRefResult.error, "Failed to update config secret ref") },
            { status: 500 },
          )
        }

        updated += 1
        continue
      }

      const secretName = buildVaultSecretName({
        target,
        scope: entry.scope,
        projectId,
        integration: entry.integration,
        configPath: entry.config_path,
        secretKey,
      })

      const createSecretResult = await admin.rpc("files_vault_create_secret", {
        p_secret: secretValue,
        p_name: secretName,
        p_description: description,
      })

      if (createSecretResult.error) {
        if (isMissingSchemaError(createSecretResult.error)) {
          return NextResponse.json(
            { error: "Vault helper functions are missing. Run the latest database migration." },
            { status: 503 },
          )
        }
        return NextResponse.json(
          { error: toErrorMessage(createSecretResult.error, "Failed to create config secret in Vault") },
          { status: 500 },
        )
      }

      const secretId = extractUuid(createSecretResult.data)
      if (!secretId) {
        return NextResponse.json({ error: "Vault secret creation returned an invalid id" }, { status: 500 })
      }

      const insertRefResult = await admin
        .from("integration_secret_refs")
        .insert({
          target_owner_type: target.target_owner_type,
          target_user_id: target.target_user_id,
          target_org_id: target.target_org_id,
          scope: entry.scope,
          project_id: projectId,
          integration: entry.integration,
          config_path: entry.config_path,
          secret_key: secretKey,
          vault_secret_id: secretId,
          vault_secret_name: secretName,
          created_by_user_id: auth.userId,
          updated_by_user_id: auth.userId,
          updated_at: new Date().toISOString(),
        })

      if (insertRefResult.error) {
        return NextResponse.json(
          { error: toErrorMessage(insertRefResult.error, "Failed to persist config secret ref") },
          { status: 500 },
        )
      }

      created += 1
    }
  }

  return NextResponse.json({
    ok: true,
    created,
    updated,
    synced: created + updated,
  })
}
