import { createHash, randomBytes } from "node:crypto"

const MCP_API_KEY_REGEX = /^mem_[a-f0-9]{64}$/

export function generateMcpApiKey(): string {
  return `mem_${randomBytes(32).toString("hex")}`
}

export function hashMcpApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex")
}

export function isValidMcpApiKey(apiKey: string): boolean {
  return MCP_API_KEY_REGEX.test(apiKey)
}

export function getMcpApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12)
}

export function getMcpApiKeyLast4(apiKey: string): string {
  return apiKey.slice(-4)
}

export function formatMcpApiKeyPreview(prefix: string | null, last4: string | null): string | null {
  if (!prefix || !last4) return null
  return `${prefix}${"*".repeat(20)}${last4}`
}
