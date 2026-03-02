const BEARER_HEADER_PATTERN = /^Bearer\s+(.+)$/i

export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null

  const match = BEARER_HEADER_PATTERN.exec(authHeader.trim())
  if (!match) return null

  const token = match[1]?.trim() ?? ""
  return token.length > 0 ? token : null
}

function normalizeFallbackSeconds(value: number): number {
  if (!Number.isFinite(value)) return 60
  return Math.max(1, Math.ceil(value))
}

export function parseRetryAfterSeconds(
  retryAfterHeader: string | null | undefined,
  fallbackSeconds = 60,
  nowMs = Date.now()
): number {
  const fallback = normalizeFallbackSeconds(fallbackSeconds)
  if (!retryAfterHeader) return fallback

  const trimmed = retryAfterHeader.trim()
  if (!trimmed) return fallback

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    return Math.max(1, Math.ceil(numeric))
  }

  const parsedDateMs = Date.parse(trimmed)
  if (Number.isFinite(parsedDateMs)) {
    return Math.max(1, Math.ceil((parsedDateMs - nowMs) / 1000))
  }

  return fallback
}
