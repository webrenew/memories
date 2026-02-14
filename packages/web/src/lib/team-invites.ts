const TEAM_INVITE_TTL_HOURS = 24

const ONE_HOUR_MS = 60 * 60 * 1000

export function getTeamInviteExpiresAt(now = Date.now()): string {
  return new Date(now + TEAM_INVITE_TTL_HOURS * ONE_HOUR_MS).toISOString()
}

export function getTeamInviteExpiryLabel(): string {
  return `${TEAM_INVITE_TTL_HOURS} hours`
}

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

export function getInviteTokenCandidates(rawToken: string): string[] {
  const trimmed = rawToken.trim()
  const decoded = safeDecode(trimmed)

  const variants = [
    trimmed,
    decoded,
    trimmed.replace(/\s+/g, "+"),
    decoded.replace(/\s+/g, "+"),
    trimmed.replace(/\s+/g, ""),
    decoded.replace(/\s+/g, ""),
  ]

  return Array.from(new Set(variants.map((token) => token.trim()).filter(Boolean)))
}
