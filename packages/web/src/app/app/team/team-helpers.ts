export function formatLastLogin(lastLoginAt: string | null): string {
  if (!lastLoginAt) return "Never"
  const date = new Date(lastLoginAt)
  if (Number.isNaN(date.getTime())) return "Unknown"
  return date.toLocaleString()
}

export function formatAuditAction(action: string): string {
  return action
    .split("_")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ")
}

export function summarizeAuditMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!metadata || typeof metadata !== "object") return null

  const keys = [
    "role",
    "previousRole",
    "nextRole",
    "removedBySelf",
    "domain_auto_join_enabled",
    "domain_auto_join_domain",
  ]

  const parts: string[] = []
  for (const key of keys) {
    if (!(key in metadata)) continue
    const value = metadata[key]
    if (value === null || value === undefined) continue
    parts.push(`${key}=${String(value)}`)
  }

  return parts.length > 0 ? parts.join(" • ") : null
}

export function formatListField(values: string[] | null | undefined): string {
  if (!Array.isArray(values) || values.length === 0) return ""
  return values.join("\n")
}

export function parseListField(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  )
}

export function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false

  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()

  return leftSorted.every((value, index) => value === rightSorted[index])
}
