export type TenantMappingSource = "auto" | "override"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function normalizeTenantMappingSource(input: {
  source?: unknown
  metadata?: Record<string, unknown> | null
}): TenantMappingSource {
  if (input.source === "auto" || input.source === "override") {
    return input.source
  }

  const metadata = input.metadata
  if (isRecord(metadata) && metadata.provisionedBy === "sdk_auto") {
    return "auto"
  }

  return "override"
}
