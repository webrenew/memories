import {
  getSdkEmbeddingFixedFeeUsd,
  getSdkEmbeddingMarkupPercent,
  getStripeGrowthEmbeddingMeterEventName,
} from "@/lib/env"
import { getStripe } from "@/lib/stripe"
import {
  buildSdkTenantOwnerScopeKey,
  resolveSdkProjectBillingContext,
} from "@/lib/sdk-project-billing"
import { createAdminClient } from "@/lib/supabase/admin"

type AdminClient = ReturnType<typeof createAdminClient>

const EMBEDDING_METER_MICROS_PER_USD = 1_000_000
const REDACTED_EMBEDDING_METADATA_VALUE = "[redacted]"
const METADATA_MAX_DEPTH = 4

export interface RecordSdkEmbeddingMeterEventInput {
  ownerUserId: string
  apiKeyHash: string
  tenantId: string | null
  projectId?: string | null
  userId?: string | null
  requestId: string
  modelId: string
  provider: string
  inputTokens: number
  modelInputCostUsdPerToken?: number | null
  gatewayCostUsd?: number | null
  marketCostUsd?: number | null
  estimatedCost?: boolean
  metadata?: Record<string, unknown>
  usageMonth?: string
  eventIdentifier?: string
}

export interface SdkEmbeddingUsageAggregate {
  usageMonth: string
  tenantId: string | null
  projectId: string | null
  modelId: string
  provider: string
  requestCount: number
  estimatedRequestCount: number
  inputTokens: number
  gatewayCostUsd: number
  marketCostUsd: number
  customerCostUsd: number
}

export interface SdkEmbeddingUsageSummary {
  usageMonth: string
  requestCount: number
  estimatedRequestCount: number
  inputTokens: number
  gatewayCostUsd: number
  marketCostUsd: number
  customerCostUsd: number
}

export interface ListSdkEmbeddingUsageInput {
  ownerUserId: string
  usageMonth?: string
  tenantId?: string
  projectId?: string
  userId?: string
  modelId?: string
  limit?: number
  summaryOnly?: boolean
}

export interface ListSdkEmbeddingUsageResult {
  usageMonth: string
  summary: SdkEmbeddingUsageSummary
  breakdown: SdkEmbeddingUsageAggregate[]
}

interface EmbeddingMeteringRow {
  id?: string
  usage_month: string
  tenant_id: string | null
  project_id: string | null
  model_id: string
  provider: string
  input_tokens: number
  gateway_cost_usd: number | string | null
  market_cost_usd: number | string | null
  customer_cost_usd: number | string | null
  estimated_cost: boolean
  created_at: string
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8))
}

function usageMonthStartIso(now = new Date()): string {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
}

function normalizeUsageMonth(value: string | undefined): string {
  if (!value) return usageMonthStartIso()
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }
  return usageMonthStartIso()
}

function isDuplicateKeyError(error: unknown): boolean {
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

function isMissingColumnError(error: unknown, column: string): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return (
    message.includes("column") &&
    message.includes(column.toLowerCase()) &&
    message.includes("does not exist")
  )
}

function isMissingRelationError(error: unknown, relation: string): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : ""

  if (code === "42P01") return true

  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return message.includes(`relation "${relation.toLowerCase()}" does not exist`)
}

function sanitizeIdentifier(value: string, fallback: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, "_")
  if (normalized.length === 0) return fallback
  return normalized.slice(0, 80)
}

function toMeterMicros(usd: number): number {
  return Math.max(0, Math.round(usd * EMBEDDING_METER_MICROS_PER_USD))
}

function isNumericVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 8 && value.every((item) => typeof item === "number" && Number.isFinite(item))
}

function sanitizeEmbeddingMetadataValue(value: unknown, depth: number): unknown {
  if (depth > METADATA_MAX_DEPTH) {
    return REDACTED_EMBEDDING_METADATA_VALUE
  }

  if (isNumericVector(value)) {
    return REDACTED_EMBEDDING_METADATA_VALUE
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeEmbeddingMetadataValue(item, depth + 1))
  }

  if (value && typeof value === "object") {
    const sanitizedEntries = Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      const keyLower = key.toLowerCase()
      if (keyLower.includes("embedding") || keyLower.includes("vector")) {
        return [key, REDACTED_EMBEDDING_METADATA_VALUE] as const
      }
      return [key, sanitizeEmbeddingMetadataValue(nested, depth + 1)] as const
    })
    return Object.fromEntries(sanitizedEntries)
  }

  return value
}

function sanitizeEmbeddingMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {}

  const sanitizedEntries = Object.entries(metadata).map(([key, value]) => {
    const keyLower = key.toLowerCase()
    if (keyLower.includes("embedding") || keyLower.includes("vector")) {
      return [key, REDACTED_EMBEDDING_METADATA_VALUE] as const
    }
    return [key, sanitizeEmbeddingMetadataValue(value, 1)] as const
  })

  return Object.fromEntries(sanitizedEntries)
}

export function deriveEmbeddingProviderFromModelId(modelId: string): string {
  const [provider] = modelId.split("/")
  return provider?.trim() || "unknown"
}

export function estimateEmbeddingInputTokens(content: string): number {
  const normalized = content.trim()
  if (!normalized) return 0

  // Fast fallback for billing estimation until provider tokenizers are integrated.
  return Math.max(1, Math.ceil(normalized.length / 4))
}

export function estimateGatewayCostUsd(input: {
  inputTokens: number
  modelInputCostUsdPerToken: number | null | undefined
}): number | null {
  if (!Number.isFinite(input.inputTokens) || input.inputTokens <= 0) {
    return 0
  }

  const unitCost =
    typeof input.modelInputCostUsdPerToken === "number" && Number.isFinite(input.modelInputCostUsdPerToken)
      ? input.modelInputCostUsdPerToken
      : null

  if (unitCost === null || unitCost < 0) {
    return null
  }

  return roundUsd(input.inputTokens * unitCost)
}

export function computeCustomerEmbeddingCostUsd(gatewayCostUsd: number): number {
  const normalizedGatewayCost = Math.max(0, gatewayCostUsd)
  const markupPercent = getSdkEmbeddingMarkupPercent()
  const fixedFeeUsd = getSdkEmbeddingFixedFeeUsd()
  return roundUsd(normalizedGatewayCost * (1 + markupPercent) + fixedFeeUsd)
}

async function resolveOwnerScope(input: {
  admin: AdminClient
  ownerUserId: string
}): Promise<{
  ownerScopeKey: string
  ownerType: "user" | "organization"
  ownerUserId: string
  ownerOrgId: string | null
  plan: string | null
  stripeCustomerId: string | null
}> {
  const billing = await resolveSdkProjectBillingContext(input.admin, input.ownerUserId)

  if (billing) {
    return {
      ownerScopeKey: billing.ownerScopeKey,
      ownerType: billing.ownerType,
      ownerUserId: billing.ownerUserId,
      ownerOrgId: billing.orgId,
      plan: billing.plan,
      stripeCustomerId: billing.stripeCustomerId,
    }
  }

  return {
    ownerScopeKey: buildSdkTenantOwnerScopeKey({
      ownerType: "user",
      ownerUserId: input.ownerUserId,
      orgId: null,
    }),
    ownerType: "user",
    ownerUserId: input.ownerUserId,
    ownerOrgId: null,
    plan: null,
    stripeCustomerId: null,
  }
}

function buildEventIdentifier(input: {
  requestId: string
  tenantId: string | null
  projectId: string | null
  modelId: string
  userId: string | null
}): string {
  const tenant = sanitizeIdentifier(input.tenantId ?? "global", "global")
  const project = sanitizeIdentifier(input.projectId ?? "none", "none")
  const model = sanitizeIdentifier(input.modelId, "model")
  const user = sanitizeIdentifier(input.userId ?? "anon", "anon")
  const request = sanitizeIdentifier(input.requestId, "request")
  return `sdk_embedding_${request}_${tenant}_${project}_${user}_${model}`
}

export async function recordSdkEmbeddingMeterEvent(input: RecordSdkEmbeddingMeterEventInput): Promise<void> {
  const admin = createAdminClient()
  const ownerScope = await resolveOwnerScope({
    admin,
    ownerUserId: input.ownerUserId,
  })

  const usageMonth = normalizeUsageMonth(input.usageMonth)
  const eventName = getStripeGrowthEmbeddingMeterEventName()

  let gatewayCostUsd =
    typeof input.gatewayCostUsd === "number" && Number.isFinite(input.gatewayCostUsd)
      ? Math.max(0, input.gatewayCostUsd)
      : null

  let estimatedCost = input.estimatedCost ?? gatewayCostUsd === null

  if (gatewayCostUsd === null) {
    gatewayCostUsd = estimateGatewayCostUsd({
      inputTokens: Math.max(0, Math.floor(input.inputTokens)),
      modelInputCostUsdPerToken: input.modelInputCostUsdPerToken,
    })
    estimatedCost = true
  }

  const marketCostUsd =
    typeof input.marketCostUsd === "number" && Number.isFinite(input.marketCostUsd)
      ? Math.max(0, input.marketCostUsd)
      : gatewayCostUsd

  const customerCostUsd = gatewayCostUsd !== null ? computeCustomerEmbeddingCostUsd(gatewayCostUsd) : 0
  const eventValueMicros = toMeterMicros(customerCostUsd)

  const eventIdentifier =
    input.eventIdentifier ??
    buildEventIdentifier({
      requestId: input.requestId,
      tenantId: input.tenantId,
      projectId: input.projectId ?? null,
      modelId: input.modelId,
      userId: input.userId ?? null,
    })

  const { data: inserted, error: insertError } = await admin
    .from("sdk_embedding_meter_events")
    .insert({
      owner_scope_key: ownerScope.ownerScopeKey,
      owner_type: ownerScope.ownerType,
      owner_user_id: ownerScope.ownerUserId,
      owner_org_id: ownerScope.ownerOrgId,
      stripe_customer_id: ownerScope.stripeCustomerId,
      api_key_hash: input.apiKeyHash,
      tenant_id: input.tenantId,
      project_id: input.projectId ?? null,
      user_id: input.userId ?? null,
      usage_month: usageMonth,
      request_id: input.requestId,
      event_name: eventName,
      event_identifier: eventIdentifier,
      event_value: eventValueMicros,
      model_id: input.modelId,
      provider: input.provider,
      input_tokens: Math.max(0, Math.floor(input.inputTokens)),
      gateway_cost_usd: gatewayCostUsd,
      market_cost_usd: marketCostUsd,
      customer_cost_usd: customerCostUsd,
      estimated_cost: estimatedCost,
      metadata: sanitizeEmbeddingMetadata(input.metadata),
    })
    .select("id")
    .single()

  if (insertError) {
    if (isDuplicateKeyError(insertError)) {
      return
    }

    if (isMissingRelationError(insertError, "sdk_embedding_meter_events")) {
      return
    }

    console.error("SDK embedding metering: failed to persist meter event row", insertError)
    return
  }

  const rowId = inserted?.id as string | undefined
  if (!rowId) return

  if (!ownerScope.stripeCustomerId || ownerScope.plan !== "growth" || eventValueMicros <= 0) {
    return
  }

  try {
    await getStripe().billing.meterEvents.create({
      event_name: eventName,
      identifier: eventIdentifier,
      payload: {
        stripe_customer_id: ownerScope.stripeCustomerId,
        value: String(eventValueMicros),
      },
    })

    await admin
      .from("sdk_embedding_meter_events")
      .update({ stripe_reported_at: new Date().toISOString(), stripe_last_error: null })
      .eq("id", rowId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("SDK embedding metering: Stripe meter event failed", message)
    await admin
      .from("sdk_embedding_meter_events")
      .update({ stripe_last_error: message })
      .eq("id", rowId)
  }
}

export async function listSdkEmbeddingUsage(input: ListSdkEmbeddingUsageInput): Promise<ListSdkEmbeddingUsageResult> {
  const usageMonth = normalizeUsageMonth(input.usageMonth)
  const admin = createAdminClient()
  const ownerScope = await resolveOwnerScope({
    admin,
    ownerUserId: input.ownerUserId,
  })

  const aggregateMap = new Map<string, SdkEmbeddingUsageAggregate>()

  let summaryRequestCount = 0
  let summaryEstimatedRequestCount = 0
  let summaryInputTokens = 0
  let summaryGatewayCostUsd = 0
  let summaryMarketCostUsd = 0
  let summaryCustomerCostUsd = 0

  const pageSize = 1_000
  let offset = 0

  while (true) {
    let pageQuery = admin
      .from("sdk_embedding_meter_events")
      .select(
        "usage_month, tenant_id, project_id, user_id, model_id, provider, input_tokens, gateway_cost_usd, market_cost_usd, customer_cost_usd, estimated_cost, created_at"
      )
      .eq("owner_scope_key", ownerScope.ownerScopeKey)
      .eq("usage_month", usageMonth)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (input.tenantId) {
      pageQuery = pageQuery.eq("tenant_id", input.tenantId)
    }
    if (input.projectId) {
      pageQuery = pageQuery.eq("project_id", input.projectId)
    }
    if (input.userId) {
      pageQuery = pageQuery.eq("user_id", input.userId)
    }
    if (input.modelId) {
      pageQuery = pageQuery.eq("model_id", input.modelId)
    }

    const { data, error } = await pageQuery

    if (error) {
      if (
        isMissingRelationError(error, "sdk_embedding_meter_events") ||
        isMissingColumnError(error, "owner_scope_key")
      ) {
        return {
          usageMonth,
          summary: {
            usageMonth,
            requestCount: 0,
            estimatedRequestCount: 0,
            inputTokens: 0,
            gatewayCostUsd: 0,
            marketCostUsd: 0,
            customerCostUsd: 0,
          },
          breakdown: [],
        }
      }

      throw error
    }

    const rows = (data ?? []) as EmbeddingMeteringRow[]
    if (rows.length === 0) break

    for (const row of rows) {
      const key = [
        row.tenant_id ?? "",
        row.project_id ?? "",
        row.model_id,
        row.provider,
      ].join("|")

      const requestCount = 1
      const estimatedRequestCount = row.estimated_cost ? 1 : 0
      const inputTokens = Math.max(0, Number(row.input_tokens ?? 0))
      const gatewayCostUsd = Math.max(0, toNumber(row.gateway_cost_usd))
      const marketCostUsd = Math.max(0, toNumber(row.market_cost_usd))
      const customerCostUsd = Math.max(0, toNumber(row.customer_cost_usd))

      summaryRequestCount += requestCount
      summaryEstimatedRequestCount += estimatedRequestCount
      summaryInputTokens += inputTokens
      summaryGatewayCostUsd += gatewayCostUsd
      summaryMarketCostUsd += marketCostUsd
      summaryCustomerCostUsd += customerCostUsd

      if (input.summaryOnly) {
        continue
      }

      const existing = aggregateMap.get(key)
      if (existing) {
        existing.requestCount += requestCount
        existing.estimatedRequestCount += estimatedRequestCount
        existing.inputTokens += inputTokens
        existing.gatewayCostUsd = roundUsd(existing.gatewayCostUsd + gatewayCostUsd)
        existing.marketCostUsd = roundUsd(existing.marketCostUsd + marketCostUsd)
        existing.customerCostUsd = roundUsd(existing.customerCostUsd + customerCostUsd)
        continue
      }

      aggregateMap.set(key, {
        usageMonth,
        tenantId: row.tenant_id,
        projectId: row.project_id,
        modelId: row.model_id,
        provider: row.provider,
        requestCount,
        estimatedRequestCount,
        inputTokens,
        gatewayCostUsd: roundUsd(gatewayCostUsd),
        marketCostUsd: roundUsd(marketCostUsd),
        customerCostUsd: roundUsd(customerCostUsd),
      })
    }

    if (rows.length < pageSize) {
      break
    }
    offset += pageSize
  }

  let breakdown = Array.from(aggregateMap.values()).sort((a, b) => {
    if (b.customerCostUsd !== a.customerCostUsd) {
      return b.customerCostUsd - a.customerCostUsd
    }
    if (b.inputTokens !== a.inputTokens) {
      return b.inputTokens - a.inputTokens
    }
    return b.requestCount - a.requestCount
  })

  if (typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0) {
    breakdown = breakdown.slice(0, Math.min(10_000, Math.max(1, Math.floor(input.limit))))
  }

  return {
    usageMonth,
    summary: {
      usageMonth,
      requestCount: summaryRequestCount,
      estimatedRequestCount: summaryEstimatedRequestCount,
      inputTokens: summaryInputTokens,
      gatewayCostUsd: roundUsd(summaryGatewayCostUsd),
      marketCostUsd: roundUsd(summaryMarketCostUsd),
      customerCostUsd: roundUsd(summaryCustomerCostUsd),
    },
    breakdown,
  }
}
