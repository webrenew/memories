import { createAdminClient } from "@/lib/supabase/admin"

type AdminClient = ReturnType<typeof createAdminClient>

interface SdkProjectRow {
  id: string
  tenant_id: string
  display_name: string
  description: string | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string
}

interface SdkTenantMappingRow {
  tenant_id: string
  status: string
  mapping_source: string | null
  updated_at: string
}

export interface SdkProjectSummary {
  id: string
  tenantId: string
  displayName: string
  description: string | null
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
  routingStatus: string | null
  routingSource: string | null
  routingUpdatedAt: string | null
}

function toProjectSummary(row: SdkProjectRow, mapping: SdkTenantMappingRow | null): SdkProjectSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    displayName: row.display_name,
    description: row.description,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    routingStatus: mapping?.status ?? null,
    routingSource: mapping?.mapping_source ?? null,
    routingUpdatedAt: mapping?.updated_at ?? null,
  }
}

export function isMissingSdkProjectsTableError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : ""
  if (code === "42P01") return true

  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return (
    message.includes('relation "sdk_projects" does not exist') ||
    message.includes('relation "public.sdk_projects" does not exist')
  )
}

export function isDuplicateSdkProjectError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : ""
  if (code === "23505") return true

  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return message.includes("duplicate key")
}

export async function listSdkProjectsForOwner(
  admin: AdminClient,
  ownerScopeKey: string
): Promise<SdkProjectSummary[]> {
  const { data, error } = await admin
    .from("sdk_projects")
    .select("id, tenant_id, display_name, description, created_by_user_id, created_at, updated_at")
    .eq("owner_scope_key", ownerScopeKey)
    .order("created_at", { ascending: false })

  if (error) {
    throw error
  }

  const projects = ((data as SdkProjectRow[] | null) ?? [])
  if (projects.length === 0) {
    return []
  }

  const tenantIds = projects.map((project) => project.tenant_id)
  const { data: mappingData, error: mappingError } = await admin
    .from("sdk_tenant_databases")
    .select("tenant_id, status, mapping_source, updated_at")
    .eq("owner_scope_key", ownerScopeKey)
    .in("tenant_id", tenantIds)

  if (mappingError) {
    console.error("Failed to load SDK tenant routing state for dashboard projects:", mappingError)
  }

  const mappings = new Map(
    (((mappingData as SdkTenantMappingRow[] | null) ?? []) as SdkTenantMappingRow[]).map((mapping) => [
      mapping.tenant_id,
      mapping,
    ])
  )

  return projects.map((project) => toProjectSummary(project, mappings.get(project.tenant_id) ?? null))
}

export async function createSdkProject(
  admin: AdminClient,
  input: {
    ownerScopeKey: string
    ownerType: "user" | "organization"
    ownerUserId: string | null
    ownerOrgId: string | null
    createdByUserId: string
    tenantId: string
    displayName: string
    description?: string
  }
): Promise<SdkProjectSummary> {
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from("sdk_projects")
    .insert({
      owner_scope_key: input.ownerScopeKey,
      owner_type: input.ownerType,
      owner_user_id: input.ownerUserId,
      owner_org_id: input.ownerOrgId,
      tenant_id: input.tenantId,
      display_name: input.displayName,
      description: input.description ?? null,
      created_by_user_id: input.createdByUserId,
      created_at: now,
      updated_at: now,
    })
    .select("id, tenant_id, display_name, description, created_by_user_id, created_at, updated_at")
    .single()

  if (error) {
    throw error
  }

  return toProjectSummary(data as SdkProjectRow, null)
}
