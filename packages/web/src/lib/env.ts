/**
 * Centralized environment variable access for the web package.
 * All process.env reads should go through this module.
 */

// ── Parse Helpers ────────────────────────────────────────────────────

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function parseBooleanFlag(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
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

export function getStripeProPriceId(billing: "monthly" | "annual" = "monthly"): string {
  return billing === "annual"
    ? process.env.STRIPE_PRO_PRICE_ID_ANNUAL!
    : process.env.STRIPE_PRO_PRICE_ID!
}

export function getStripeProPriceIds(): Set<string> {
  return new Set(
    [process.env.STRIPE_PRO_PRICE_ID, process.env.STRIPE_PRO_PRICE_ID_ANNUAL].filter(
      (v): v is string => Boolean(v)
    )
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
export const GRAPH_RETRIEVAL_ENABLED = parseBooleanFlag(process.env.GRAPH_RETRIEVAL_ENABLED, false)
export const GRAPH_LLM_EXTRACTION_ENABLED = parseBooleanFlag(process.env.GRAPH_LLM_EXTRACTION_ENABLED, false)

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

export function shouldAutoProvisionTenants(): boolean {
  const flag = process.env.SDK_AUTO_PROVISION_TENANTS
  if (!flag) return true
  const normalized = flag.trim().toLowerCase()
  return !(normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no")
}

export function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === "test"
}
