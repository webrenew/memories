const GITHUB_OWNER_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/i

function normalizeGithubPath(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, "")
    .replace(/^git@github\.com:/i, "github.com/")
    .replace(/\.git$/i, "")
    .toLowerCase()
}

export function normalizeGithubOwner(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null

  const normalized = normalizeGithubPath(raw.replace(/^@/, ""))
  const parts = normalized.split("/").filter(Boolean)

  let owner: string | null = null
  if (parts.length === 1) {
    owner = parts[0] ?? null
  } else if (parts[0] === "github.com") {
    owner = parts[1] ?? null
  } else {
    owner = parts[0] ?? null
  }

  if (!owner || !GITHUB_OWNER_PATTERN.test(owner)) {
    return null
  }

  return owner
}

export function parseGithubOwnerFromProjectId(projectId: string | null | undefined): string | null {
  const raw = projectId?.trim()
  if (!raw) return null

  const normalized = normalizeGithubPath(raw)
  const parts = normalized.split("/").filter(Boolean)

  if (parts.length < 3 || parts[0] !== "github.com") {
    return null
  }

  return normalizeGithubOwner(parts[1] ?? null)
}
