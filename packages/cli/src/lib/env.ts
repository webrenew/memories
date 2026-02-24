import { join } from "node:path"
import { homedir } from "node:os"

/** Resolve the data directory for memories storage. */
export function getDataDir(): string {
  return process.env.MEMORIES_DATA_DIR ?? join(homedir(), ".config", "memories")
}

/** API URL for the memories.sh cloud service. */
export function getApiUrl(): string {
  const configured = process.env.MEMORIES_API_URL?.trim()
  if (!configured) {
    return "https://memories.sh"
  }

  const normalized = configured.replace(/\/+$/, "")
  return normalized || "https://memories.sh"
}

/** Turso platform API token (required for database provisioning). */
export function getTursoApiToken(): string {
  const token = process.env.TURSO_PLATFORM_API_TOKEN
  if (!token) {
    throw new Error(
      "TURSO_PLATFORM_API_TOKEN not set. Get one at https://turso.tech/app/settings/api-tokens"
    )
  }
  return token
}

/** Whether debug logging is enabled. */
export function isDebug(): boolean {
  const raw = process.env.DEBUG
  if (!raw) {
    return false
  }

  const normalized = raw.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return !["0", "false", "off", "no", "n"].includes(normalized)
}

/** Resolve the user's preferred text editor. */
export function getEditor(): string {
  return process.env.EDITOR || process.env.VISUAL || "vi"
}
