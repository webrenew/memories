import { createHash, randomBytes } from "node:crypto"

export const CLI_AUTH_CODE_TTL_MS = 10 * 60 * 1000

export function generateCliToken(): string {
  return `cli_${randomBytes(32).toString("hex")}`
}

export function hashCliToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
