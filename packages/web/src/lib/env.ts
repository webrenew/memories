/**
 * Centralized environment variable access for the web package.
 * All process.env reads should go through this module.
 */

// ── Parse Helpers ────────────────────────────────────────────────────

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function parseBooleanFlag(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
}

export function parseNonNegativeFloat(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "")
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }
  return parsed
}

// ── Supabase ─────────────────────────────────────────────────────────
// NEXT_PUBLIC_ vars are inlined by the Next.js bundler at build time.

export function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL!
}

export function getSupabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
}

export function getSupabaseServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY!
}

export function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// ── Stripe ───────────────────────────────────────────────────────────

export function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
  return key
}

export type StripeBillingInterval = "monthly" | "annual"
export type StripeCheckoutPlan = "individual" | "team" | "growth"

function envValue(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]
    if (value && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

export function getStripeIndividualPriceId(billing: StripeBillingInterval = "monthly"): string {
  const value =
    billing === "annual"
      ? envValue("STRIPE_MEMORIES_INDIVIDUAL_PRICE_ID_ANNUAL", "STRIPE_PRO_PRICE_ID_ANNUAL")
      : envValue("STRIPE_MEMORIES_INDIVIDUAL_PRICE_ID", "STRIPE_PRO_PRICE_ID")

  if (!value) {
    throw new Error(
      billing === "annual"
        ? "Missing STRIPE_MEMORIES_INDIVIDUAL_PRICE_ID_ANNUAL (or STRIPE_PRO_PRICE_ID_ANNUAL)"
        : "Missing STRIPE_MEMORIES_INDIVIDUAL_PRICE_ID (or STRIPE_PRO_PRICE_ID)"
    )
  }

  return value
}

export function getStripeTeamSeatPriceId(billing: StripeBillingInterval = "monthly"): string {
  const value =
    billing === "annual"
      ? envValue("STRIPE_MEMORIES_TEAM_SEAT_PRICE_ID_ANNUAL")
      : envValue("STRIPE_MEMORIES_TEAM_SEAT_PRICE_ID")

  if (!value) {
    throw new Error(
      billing === "annual"
        ? "Missing STRIPE_MEMORIES_TEAM_SEAT_PRICE_ID_ANNUAL"
        : "Missing STRIPE_MEMORIES_TEAM_SEAT_PRICE_ID"
    )
  }

  return value
}

export function getStripeGrowthBasePriceId(billing: StripeBillingInterval = "monthly"): string {
  const value =
    billing === "annual"
      ? envValue("STRIPE_MEMORIES_GROWTH_BASE_PRICE_ID_ANNUAL")
      : envValue("STRIPE_MEMORIES_GROWTH_BASE_PRICE_ID")

  if (!value) {
    throw new Error(
      billing === "annual"
        ? "Missing STRIPE_MEMORIES_GROWTH_BASE_PRICE_ID_ANNUAL"
        : "Missing STRIPE_MEMORIES_GROWTH_BASE_PRICE_ID"
    )
  }

  return value
}

export function getStripeGrowthOveragePriceId(): string {
  const value = envValue("STRIPE_MEMORIES_GROWTH_OVERAGE_PRICE_ID")
  if (!value) {
    throw new Error("Missing STRIPE_MEMORIES_GROWTH_OVERAGE_PRICE_ID")
  }
  return value
}

export function getStripeCheckoutPriceId(
  plan: StripeCheckoutPlan,
  billing: StripeBillingInterval = "monthly"
): string {
  if (plan === "team") return getStripeTeamSeatPriceId(billing)
  if (plan === "growth") return getStripeGrowthBasePriceId(billing)
  return getStripeIndividualPriceId(billing)
}

export function getStripeGrowthMeterEventName(): string {
  return envValue("STRIPE_MEMORIES_GROWTH_METER_EVENT_NAME") ?? "memories_growth_projects"
}

export function getStripeGrowthEmbeddingMeterEventName(): string {
  return envValue("STRIPE_MEMORIES_GROWTH_EMBEDDING_METER_EVENT_NAME") ?? "memories_growth_embedding_cost_micros"
}

export function getSdkEmbeddingMarkupPercent(): number {
  return parseNonNegativeFloat(process.env.SDK_EMBEDDING_MARKUP_PERCENT, 0.15)
}

export function getSdkEmbeddingFixedFeeUsd(): number {
  return parseNonNegativeFloat(process.env.SDK_EMBEDDING_FIXED_FEE_USD, 0)
}

export function getStripeMeterMaxProjectsPerMonth(): number | null {
  const raw = process.env.SDK_GROWTH_MAX_PROJECTS_PER_MONTH
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export function getStripeProPriceId(billing: "monthly" | "annual" = "monthly"): string {
  return getStripeIndividualPriceId(billing)
}

export function getStripeProPriceIds(): Set<string> {
  return getStripeManagedPriceIds()
}

export function getStripeManagedPriceIds(): Set<string> {
  const values = [
    envValue("STRIPE_MEMORIES_INDIVIDUAL_PRICE_ID", "STRIPE_PRO_PRICE_ID"),
    envValue("STRIPE_MEMORIES_INDIVIDUAL_PRICE_ID_ANNUAL", "STRIPE_PRO_PRICE_ID_ANNUAL"),
    envValue("STRIPE_MEMORIES_TEAM_SEAT_PRICE_ID"),
    envValue("STRIPE_MEMORIES_TEAM_SEAT_PRICE_ID_ANNUAL"),
    envValue("STRIPE_MEMORIES_GROWTH_BASE_PRICE_ID"),
    envValue("STRIPE_MEMORIES_GROWTH_BASE_PRICE_ID_ANNUAL"),
    envValue("STRIPE_MEMORIES_GROWTH_OVERAGE_PRICE_ID"),
  ].filter((value): value is string => Boolean(value))

  return new Set(values)
}

export function getStripeIndividualPriceIds(): Set<string> {
  return new Set(
    [
      envValue("STRIPE_MEMORIES_INDIVIDUAL_PRICE_ID", "STRIPE_PRO_PRICE_ID"),
      envValue("STRIPE_MEMORIES_INDIVIDUAL_PRICE_ID_ANNUAL", "STRIPE_PRO_PRICE_ID_ANNUAL"),
    ].filter((value): value is string => Boolean(value))
  )
}

export function getStripeTeamSeatPriceIds(): Set<string> {
  return new Set(
    [envValue("STRIPE_MEMORIES_TEAM_SEAT_PRICE_ID"), envValue("STRIPE_MEMORIES_TEAM_SEAT_PRICE_ID_ANNUAL")].filter(
      (value): value is string => Boolean(value)
    )
  )
}

export function getStripeGrowthPriceIds(): Set<string> {
  return new Set(
    [
      envValue("STRIPE_MEMORIES_GROWTH_BASE_PRICE_ID"),
      envValue("STRIPE_MEMORIES_GROWTH_BASE_PRICE_ID_ANNUAL"),
      envValue("STRIPE_MEMORIES_GROWTH_OVERAGE_PRICE_ID"),
    ].filter((value): value is string => Boolean(value))
  )
}

export function getStripeWebhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET!
}

// ── Turso ────────────────────────────────────────────────────────────

export function getTursoOrgSlug(): string {
  return process.env.TURSO_ORG_SLUG ?? "webrenew"
}

export function getTursoPlatformApiToken(): string {
  const token = process.env.TURSO_PLATFORM_API_TOKEN
  if (!token) throw new Error("TURSO_PLATFORM_API_TOKEN not set")
  return token
}

export function hasTursoPlatformApiToken(): boolean {
  return Boolean(process.env.TURSO_PLATFORM_API_TOKEN)
}

/** Turso API token used for account deletion (different from platform API token). */
export function getTursoApiToken(): string | undefined {
  return process.env.TURSO_API_TOKEN
}

// ── Upstash Redis ────────────────────────────────────────────────────

export function getUpstashRedisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) return { url, token }
  return null
}

// ── Resend ───────────────────────────────────────────────────────────

export function hasResendApiKey(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export function getResendApiKey(): string {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error("RESEND_API_KEY is not set")
  return key
}

export function getResendFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || "memories.sh <team@memories.sh>"
}

// ── MCP ──────────────────────────────────────────────────────────────

export const MCP_WORKING_MEMORY_TTL_HOURS = parsePositiveInt(process.env.MCP_WORKING_MEMORY_TTL_HOURS, 24)
export const MCP_WORKING_MEMORY_MAX_ITEMS_PER_USER = parsePositiveInt(
  process.env.MCP_WORKING_MEMORY_MAX_ITEMS_PER_USER,
  200
)
export const MCP_MAX_CONNECTIONS_PER_KEY = parsePositiveInt(process.env.MCP_MAX_CONNECTIONS_PER_KEY, 5)
export const MCP_MAX_CONNECTIONS_PER_IP = parsePositiveInt(process.env.MCP_MAX_CONNECTIONS_PER_IP, 20)
export const MCP_SESSION_IDLE_MS = parsePositiveInt(process.env.MCP_SESSION_IDLE_MS, 15 * 60 * 1000)

// ── Graph Features ───────────────────────────────────────────────────

export const GRAPH_MAPPING_ENABLED = parseBooleanFlag(process.env.GRAPH_MAPPING_ENABLED, false)
export const GRAPH_RETRIEVAL_ENABLED = parseBooleanFlag(process.env.GRAPH_RETRIEVAL_ENABLED, true)
export const GRAPH_LLM_EXTRACTION_ENABLED = parseBooleanFlag(process.env.GRAPH_LLM_EXTRACTION_ENABLED, false)
export const GRAPH_ROLLOUT_AUTOPILOT_ENABLED = parseBooleanFlag(process.env.GRAPH_ROLLOUT_AUTOPILOT_ENABLED, false)
export const GRAPH_DEFAULT_STRATEGY_AUTOPILOT_ENABLED = parseBooleanFlag(
  process.env.GRAPH_DEFAULT_STRATEGY_AUTOPILOT_ENABLED,
  true
)

export function getSimilarityEdgeThreshold(): number {
  const value = parseNonNegativeFloat(process.env.SIMILARITY_EDGE_THRESHOLD, 0.85)
  return Math.max(0, Math.min(1, value))
}

export function getSimilarityEdgeMaxK(): number {
  return parsePositiveInt(process.env.SIMILARITY_EDGE_MAX_K, 20)
}

export function getSimilarityEdgeMaxPerMemory(): number {
  return parsePositiveInt(process.env.SIMILARITY_EDGE_MAX_PER_MEMORY, 5)
}

export function getGraphLlmAmbiguousSimilarityMin(): number {
  const value = parseNonNegativeFloat(process.env.GRAPH_LLM_AMBIGUOUS_SIMILARITY_MIN, 0.7)
  return Math.max(0, Math.min(1, value))
}

export function getGraphLlmAmbiguousSimilarityMax(): number {
  const value = parseNonNegativeFloat(process.env.GRAPH_LLM_AMBIGUOUS_SIMILARITY_MAX, 0.9)
  return Math.max(0, Math.min(1, value))
}

export function getGraphLlmRelationshipConfidenceThreshold(): number {
  const value = parseNonNegativeFloat(process.env.GRAPH_LLM_RELATIONSHIP_CONFIDENCE_THRESHOLD, 0.7)
  return Math.max(0, Math.min(1, value))
}

export function getGraphLlmRelationshipModelId(): string {
  return envValue("GRAPH_LLM_RELATIONSHIP_MODEL_ID") ?? "anthropic/claude-3-5-haiku-latest"
}

export function getGraphLlmSemanticContextLimit(): number {
  return parsePositiveInt(process.env.GRAPH_LLM_SEMANTIC_CONTEXT_LIMIT, 20)
}

export function getGraphLlmSemanticConfidenceThreshold(): number {
  const value = parseNonNegativeFloat(process.env.GRAPH_LLM_SEMANTIC_CONFIDENCE_THRESHOLD, 0.6)
  return Math.max(0, Math.min(1, value))
}

export function getGraphLlmSemanticMinChars(): number {
  return parsePositiveInt(process.env.GRAPH_LLM_SEMANTIC_MIN_CHARS, 20)
}

// ── Other ────────────────────────────────────────────────────────────

export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://memories.sh"
}

export function getEnterpriseContactTo(): string {
  return process.env.ENTERPRISE_CONTACT_TO || "hello@memories.sh"
}

export function getGithubWebhookSecret(): string | undefined {
  return process.env.GITHUB_WEBHOOK_SECRET
}

export function hasAiGatewayApiKey(): boolean {
  return Boolean(envValue("AI_GATEWAY_API_KEY"))
}

export function getAiGatewayApiKey(): string {
  const value = envValue("AI_GATEWAY_API_KEY")
  if (!value) {
    throw new Error("Missing AI_GATEWAY_API_KEY")
  }
  return value
}

export function getAiGatewayBaseUrl(): string {
  return envValue("AI_GATEWAY_BASE_URL") ?? "https://ai-gateway.vercel.sh"
}

export function getSdkDefaultEmbeddingModelId(): string {
  return envValue("SDK_DEFAULT_EMBEDDING_MODEL_ID") ?? "openai/text-embedding-3-small"
}

export function getSdkEmbeddingJobMaxAttempts(): number {
  return parsePositiveInt(process.env.SDK_EMBEDDING_JOB_MAX_ATTEMPTS, 5)
}

export function getSdkEmbeddingJobRetryBaseMs(): number {
  return parsePositiveInt(process.env.SDK_EMBEDDING_JOB_RETRY_BASE_MS, 1_000)
}

export function getSdkEmbeddingJobRetryMaxMs(): number {
  return parsePositiveInt(process.env.SDK_EMBEDDING_JOB_RETRY_MAX_MS, 60_000)
}

export function getSdkEmbeddingJobWorkerBatchSize(): number {
  return parsePositiveInt(process.env.SDK_EMBEDDING_JOB_WORKER_BATCH_SIZE, 2)
}

export function getSdkEmbeddingJobProcessingTimeoutMs(): number {
  return parsePositiveInt(process.env.SDK_EMBEDDING_JOB_PROCESSING_TIMEOUT_MS, 5 * 60 * 1_000)
}

export function getSdkEmbeddingBackfillBatchSize(): number {
  return parsePositiveInt(process.env.SDK_EMBEDDING_BACKFILL_BATCH_SIZE, 100)
}

export function getSdkEmbeddingBackfillThrottleMs(): number {
  return parseNonNegativeInt(process.env.SDK_EMBEDDING_BACKFILL_THROTTLE_MS, 25)
}

export function shouldAutoProvisionTenants(): boolean {
  const flag = process.env.SDK_AUTO_PROVISION_TENANTS
  if (!flag) return true
  const normalized = flag.trim().toLowerCase()
  return !(normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no")
}

export function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === "test"
}
