import {
  getAiGatewayApiKey,
  getAiGatewayBaseUrl,
  getSdkDefaultEmbeddingModelId,
} from "@/lib/env"
import { apiError, ToolExecutionError } from "@/lib/memory-service/tools"
import {
  buildSdkTenantOwnerScopeKey,
  resolveSdkProjectBillingContext,
} from "@/lib/sdk-project-billing"
import { createAdminClient } from "@/lib/supabase/admin"

export type EmbeddingModelSelectionSource = "request" | "project" | "workspace" | "system_default"

export interface GatewayEmbeddingModelCatalogItem {
  id: string
  name: string
  provider: string
  description: string | null
  contextWindow: number | null
  pricing: {
    input: string | null
  }
  inputCostUsdPerToken: number | null
  tags: string[]
}

export interface ResolvedSdkEmbeddingModelSelection {
  selectedModelId: string
  source: EmbeddingModelSelectionSource
  workspaceDefaultModelId: string | null
  projectOverrideModelId: string | null
  allowlistModelIds: string[]
  availableModels: GatewayEmbeddingModelCatalogItem[]
}

export interface ResolveSdkEmbeddingModelSelectionInput {
  ownerUserId: string
  apiKeyHash: string
  tenantId: string | null
  projectId?: string | null
  requestedModelId?: string | null
}

const MODEL_CACHE_TTL_MS = 60_000

let cachedCatalog:
  | {
      expiresAt: number
      models: GatewayEmbeddingModelCatalogItem[]
    }
  | null = null

type GatewayModelRecord = {
  id?: unknown
  type?: unknown
  owned_by?: unknown
  name?: unknown
  description?: unknown
  context_window?: unknown
  pricing?: unknown
  tags?: unknown
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)

  if (normalized.length === 0) {
    return null
  }

  return Array.from(new Set(normalized))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseProjectOverrideModelId(metadata: Record<string, unknown> | null, projectId: string | null | undefined): string | null {
  if (!metadata || !projectId) {
    return null
  }

  const map =
    asRecord(metadata.embeddingModelByProject) ??
    asRecord(metadata.embeddingModelsByProject) ??
    asRecord(metadata.embedding_model_by_project) ??
    asRecord(metadata.embedding_models_by_project)

  if (!map) {
    return null
  }

  const exact = map[projectId]
  if (typeof exact === "string" && exact.trim().length > 0) {
    return exact.trim()
  }

  const wildcard = map["*"]
  if (typeof wildcard === "string" && wildcard.trim().length > 0) {
    return wildcard.trim()
  }

  return null
}

function parseAllowlistModelIds(metadata: Record<string, unknown> | null): string[] | null {
  if (!metadata) {
    return null
  }

  return (
    parseStringArray(metadata.embeddingModelAllowlist) ??
    parseStringArray(metadata.embedding_model_allowlist) ??
    parseStringArray(metadata.allowedEmbeddingModels) ??
    parseStringArray(metadata.allowed_embedding_models)
  )
}

function parseTenantDefaultModelId(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) {
    return null
  }

  const value =
    metadata.defaultEmbeddingModel ??
    metadata.default_embedding_model ??
    metadata.embeddingModel ??
    metadata.embedding_model

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function isMissingColumnError(error: unknown, column: string): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return message.includes("column") && message.includes(column.toLowerCase()) && message.includes("does not exist")
}

function toCatalogItem(raw: GatewayModelRecord): GatewayEmbeddingModelCatalogItem | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : ""
  const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : ""
  if (!id || type !== "embedding") {
    return null
  }

  const providerFromOwner = typeof raw.owned_by === "string" ? raw.owned_by.trim() : ""
  const provider = providerFromOwner || id.split("/")[0] || "unknown"

  const pricingRecord = asRecord(raw.pricing)
  const inputPricingRaw = pricingRecord?.input
  const inputPricing =
    typeof inputPricingRaw === "string"
      ? inputPricingRaw
      : typeof inputPricingRaw === "number" && Number.isFinite(inputPricingRaw)
        ? String(inputPricingRaw)
        : null

  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : id,
    provider,
    description: typeof raw.description === "string" && raw.description.trim().length > 0 ? raw.description : null,
    contextWindow: parseNumber(raw.context_window),
    pricing: {
      input: inputPricing,
    },
    inputCostUsdPerToken: parseNumber(inputPricingRaw),
    tags: parseStringArray(raw.tags) ?? [],
  }
}

async function fetchGatewayEmbeddingModels(forceRefresh = false): Promise<GatewayEmbeddingModelCatalogItem[]> {
  const now = Date.now()
  if (!forceRefresh && cachedCatalog && cachedCatalog.expiresAt > now) {
    return cachedCatalog.models
  }

  const apiKey = getAiGatewayApiKey()
  const baseUrl = getAiGatewayBaseUrl().replace(/\/$/, "")

  const response = await fetch(`${baseUrl}/v1/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  })

  if (!response.ok) {
    throw new ToolExecutionError(
      apiError({
        type: "internal_error",
        code: "EMBEDDING_MODEL_CATALOG_FETCH_FAILED",
        message: "Failed to fetch embedding model catalog from AI Gateway",
        status: 502,
        retryable: true,
        details: { status: response.status },
      }),
      { rpcCode: -32000 }
    )
  }

  const body = (await response.json().catch(() => null)) as { data?: unknown } | null
  const data = Array.isArray(body?.data) ? (body?.data as GatewayModelRecord[]) : []
  const models = data
    .map(toCatalogItem)
    .filter((model): model is GatewayEmbeddingModelCatalogItem => model !== null)
    .sort((a, b) => a.id.localeCompare(b.id))

  cachedCatalog = {
    expiresAt: now + MODEL_CACHE_TTL_MS,
    models,
  }

  return models
}

async function resolveOwnerScopeKey(ownerUserId: string): Promise<string> {
  const admin = createAdminClient()
  const billing = await resolveSdkProjectBillingContext(admin, ownerUserId)

  return (
    billing?.ownerScopeKey ??
    buildSdkTenantOwnerScopeKey({
      ownerType: "user",
      ownerUserId,
      orgId: null,
    })
  )
}

async function readWorkspaceDefaultModelId(ownerUserId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select("embedding_model")
    .eq("id", ownerUserId)
    .maybeSingle()

  if (error) {
    console.error("Failed to resolve workspace default embedding model:", error)
    return null
  }

  const model = data?.embedding_model
  return typeof model === "string" && model.trim().length > 0 ? model.trim() : null
}

async function readTenantMetadata(params: {
  ownerScopeKey: string
  apiKeyHash: string
  tenantId: string
}): Promise<Record<string, unknown> | null> {
  const admin = createAdminClient()
  const baseSelect = "metadata"

  const byOwnerScope = await admin
    .from("sdk_tenant_databases")
    .select(baseSelect)
    .eq("owner_scope_key", params.ownerScopeKey)
    .eq("tenant_id", params.tenantId)
    .maybeSingle()

  if (!byOwnerScope.error && byOwnerScope.data) {
    return asRecord(byOwnerScope.data.metadata) ?? {}
  }

  if (byOwnerScope.error && !isMissingColumnError(byOwnerScope.error, "owner_scope_key")) {
    console.error("Failed to resolve tenant metadata for embedding model selection:", byOwnerScope.error)
    return null
  }

  const byApiKey = await admin
    .from("sdk_tenant_databases")
    .select(baseSelect)
    .eq("api_key_hash", params.apiKeyHash)
    .eq("tenant_id", params.tenantId)
    .maybeSingle()

  if (byApiKey.error) {
    console.error("Failed to resolve tenant metadata by API key for embedding model selection:", byApiKey.error)
    return null
  }

  return asRecord(byApiKey.data?.metadata) ?? {}
}

function validationError(code: string, message: string, details?: Record<string, unknown>): ToolExecutionError {
  return new ToolExecutionError(
    apiError({
      type: "validation_error",
      code,
      message,
      status: 400,
      retryable: false,
      details,
    }),
    { rpcCode: -32602 }
  )
}

function pickFirstAllowedModel(
  models: GatewayEmbeddingModelCatalogItem[],
  allowedModelIds: string[]
): GatewayEmbeddingModelCatalogItem | null {
  for (const model of models) {
    if (allowedModelIds.includes(model.id)) {
      return model
    }
  }
  return null
}

export async function listGatewayEmbeddingModels(forceRefresh = false): Promise<GatewayEmbeddingModelCatalogItem[]> {
  return fetchGatewayEmbeddingModels(forceRefresh)
}

export async function resolveSdkEmbeddingModelSelection(
  input: ResolveSdkEmbeddingModelSelectionInput
): Promise<ResolvedSdkEmbeddingModelSelection> {
  const availableModels = await fetchGatewayEmbeddingModels()
  if (availableModels.length === 0) {
    throw new ToolExecutionError(
      apiError({
        type: "internal_error",
        code: "EMBEDDING_MODEL_CATALOG_EMPTY",
        message: "AI Gateway did not return any embedding models",
        status: 502,
        retryable: true,
      }),
      { rpcCode: -32000 }
    )
  }

  const availableModelIds = availableModels.map((model) => model.id)
  const availableSet = new Set(availableModelIds)

  const ownerScopeKey = await resolveOwnerScopeKey(input.ownerUserId)
  const workspaceDefaultModelId = await readWorkspaceDefaultModelId(input.ownerUserId)
  const tenantMetadata = input.tenantId
    ? await readTenantMetadata({
        ownerScopeKey,
        apiKeyHash: input.apiKeyHash,
        tenantId: input.tenantId,
      })
    : null

  const tenantDefaultModelId = parseTenantDefaultModelId(tenantMetadata)
  const projectOverrideModelId = parseProjectOverrideModelId(tenantMetadata, input.projectId)
  const allowlistRaw = parseAllowlistModelIds(tenantMetadata)

  const allowlistModelIds =
    allowlistRaw && allowlistRaw.length > 0
      ? allowlistRaw.filter((modelId) => availableSet.has(modelId))
      : availableModelIds

  if (allowlistModelIds.length === 0) {
    throw validationError(
      "EMBEDDING_MODEL_ALLOWLIST_EMPTY",
      "No allowed embedding models are currently available in AI Gateway",
      {
        allowlist: allowlistRaw,
      }
    )
  }

  const requestedModelId =
    typeof input.requestedModelId === "string" && input.requestedModelId.trim().length > 0
      ? input.requestedModelId.trim()
      : null

  if (requestedModelId) {
    if (!availableSet.has(requestedModelId)) {
      throw validationError("UNSUPPORTED_EMBEDDING_MODEL", "Unsupported embedding model", {
        requestedModelId,
        availableModelIds,
      })
    }

    if (!allowlistModelIds.includes(requestedModelId)) {
      throw validationError("EMBEDDING_MODEL_NOT_ALLOWED", "Embedding model is not allowed for this workspace", {
        requestedModelId,
        allowlistModelIds,
      })
    }

    return {
      selectedModelId: requestedModelId,
      source: "request",
      workspaceDefaultModelId,
      projectOverrideModelId,
      allowlistModelIds,
      availableModels,
    }
  }

  if (projectOverrideModelId && availableSet.has(projectOverrideModelId) && allowlistModelIds.includes(projectOverrideModelId)) {
    return {
      selectedModelId: projectOverrideModelId,
      source: "project",
      workspaceDefaultModelId,
      projectOverrideModelId,
      allowlistModelIds,
      availableModels,
    }
  }

  if (tenantDefaultModelId && availableSet.has(tenantDefaultModelId) && allowlistModelIds.includes(tenantDefaultModelId)) {
    return {
      selectedModelId: tenantDefaultModelId,
      source: "workspace",
      workspaceDefaultModelId,
      projectOverrideModelId,
      allowlistModelIds,
      availableModels,
    }
  }

  if (workspaceDefaultModelId && availableSet.has(workspaceDefaultModelId) && allowlistModelIds.includes(workspaceDefaultModelId)) {
    return {
      selectedModelId: workspaceDefaultModelId,
      source: "workspace",
      workspaceDefaultModelId,
      projectOverrideModelId,
      allowlistModelIds,
      availableModels,
    }
  }

  const sdkDefaultModelId = getSdkDefaultEmbeddingModelId()
  if (availableSet.has(sdkDefaultModelId) && allowlistModelIds.includes(sdkDefaultModelId)) {
    return {
      selectedModelId: sdkDefaultModelId,
      source: "system_default",
      workspaceDefaultModelId,
      projectOverrideModelId,
      allowlistModelIds,
      availableModels,
    }
  }

  const fallbackModel = pickFirstAllowedModel(availableModels, allowlistModelIds)
  if (!fallbackModel) {
    throw validationError("EMBEDDING_MODEL_NOT_ALLOWED", "No embedding model is available for this workspace", {
      allowlistModelIds,
    })
  }

  return {
    selectedModelId: fallbackModel.id,
    source: "system_default",
    workspaceDefaultModelId,
    projectOverrideModelId,
    allowlistModelIds,
    availableModels,
  }
}
