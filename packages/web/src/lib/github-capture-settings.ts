import type { GithubCaptureCandidate, GithubCaptureEvent } from "@/lib/github-capture"

const GITHUB_CAPTURE_EVENT_VALUES = ["pull_request", "issues", "push", "release"] as const

export type GithubCaptureAllowedEvent = (typeof GITHUB_CAPTURE_EVENT_VALUES)[number]

const EVENT_ALIAS_MAP: Record<string, GithubCaptureAllowedEvent> = {
  pr: "pull_request",
  pull_request: "pull_request",
  issue: "issues",
  issues: "issues",
  push: "push",
  release: "release",
}

export interface GithubCaptureSettings {
  allowed_events: GithubCaptureAllowedEvent[]
  repo_allow_list: string[]
  repo_block_list: string[]
  branch_filters: string[]
  label_filters: string[]
  actor_filters: string[]
  include_prerelease: boolean
}

export interface GithubCaptureSettingsRow {
  allowed_events?: unknown
  repo_allow_list?: unknown
  repo_block_list?: unknown
  branch_filters?: unknown
  label_filters?: unknown
  actor_filters?: unknown
  include_prerelease?: unknown
  updated_at?: string | null
}

const DEFAULT_GITHUB_CAPTURE_SETTINGS: GithubCaptureSettings = {
  allowed_events: [...GITHUB_CAPTURE_EVENT_VALUES],
  repo_allow_list: [],
  repo_block_list: [],
  branch_filters: [],
  label_filters: [],
  actor_filters: [],
  include_prerelease: true,
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toUniqueList<T extends string>(values: T[]): T[] {
  const unique = new Set<T>()
  for (const value of values) {
    if (!value) continue
    unique.add(value)
  }
  return Array.from(unique)
}

function coerceTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

function normalizeRepoName(value: string): string | null {
  const normalized = value
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .trim()
    .toLowerCase()

  const parts = normalized.split("/").filter(Boolean)
  if (parts.length !== 2) return null

  return `${parts[0]}/${parts[1]}`
}

function normalizeBranch(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/^refs\/heads\//, "")
  return normalized.length > 0 ? normalized : null
}

function normalizeLabel(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function normalizeActor(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/^@+/, "")
  return normalized.length > 0 ? normalized : null
}

export function normalizeAllowedEvents(values: unknown): GithubCaptureAllowedEvent[] {
  const events = coerceTextArray(values)
    .map((value) => EVENT_ALIAS_MAP[value.trim().toLowerCase()])
    .filter((value): value is GithubCaptureAllowedEvent => Boolean(value))

  return toUniqueList(events)
}

export function normalizeRepoFilterList(values: unknown): string[] {
  const repos = coerceTextArray(values)
    .map((value) => normalizeRepoName(value))
    .filter((value): value is string => Boolean(value))

  return toUniqueList(repos)
}

export function normalizeBranchFilterList(values: unknown): string[] {
  const filters = coerceTextArray(values)
    .map((value) => normalizeBranch(value))
    .filter((value): value is string => Boolean(value))

  return toUniqueList(filters)
}

export function normalizeLabelFilterList(values: unknown): string[] {
  const filters = coerceTextArray(values)
    .map((value) => normalizeLabel(value))
    .filter((value): value is string => Boolean(value))

  return toUniqueList(filters)
}

export function normalizeActorFilterList(values: unknown): string[] {
  const filters = coerceTextArray(values)
    .map((value) => normalizeActor(value))
    .filter((value): value is string => Boolean(value))

  return toUniqueList(filters)
}

export function buildGithubCaptureSettingsFromRow(
  row: GithubCaptureSettingsRow | null | undefined
): GithubCaptureSettings {
  if (!row) {
    return {
      ...DEFAULT_GITHUB_CAPTURE_SETTINGS,
    }
  }

  const allowedEvents = normalizeAllowedEvents(row.allowed_events)

  return {
    allowed_events:
      allowedEvents.length > 0 ? allowedEvents : [...DEFAULT_GITHUB_CAPTURE_SETTINGS.allowed_events],
    repo_allow_list: normalizeRepoFilterList(row.repo_allow_list),
    repo_block_list: normalizeRepoFilterList(row.repo_block_list),
    branch_filters: normalizeBranchFilterList(row.branch_filters),
    label_filters: normalizeLabelFilterList(row.label_filters),
    actor_filters: normalizeActorFilterList(row.actor_filters),
    include_prerelease:
      typeof row.include_prerelease === "boolean"
        ? row.include_prerelease
        : DEFAULT_GITHUB_CAPTURE_SETTINGS.include_prerelease,
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function patternMatches(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) {
    return pattern === value
  }

  const regex = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`)
  return regex.test(value)
}

function matchesAny(patterns: string[], value: string): boolean {
  return patterns.some((pattern) => patternMatches(pattern, value))
}

function extractBranch(candidate: GithubCaptureCandidate): string | null {
  const metadata = candidate.metadata
  if (!metadata || typeof metadata !== "object") return null

  const branch = asText((metadata as { branch?: unknown }).branch)
  if (branch) return normalizeBranch(branch)

  const targetCommitish = asText((metadata as { target_commitish?: unknown }).target_commitish)
  if (targetCommitish) return normalizeBranch(targetCommitish)

  const ref = asText((metadata as { ref?: unknown }).ref)
  if (ref) return normalizeBranch(ref)

  return null
}

function extractLabels(candidate: GithubCaptureCandidate): string[] {
  const metadata = candidate.metadata
  if (!metadata || typeof metadata !== "object") return []

  const labels = (metadata as { labels?: unknown }).labels
  if (!Array.isArray(labels)) return []

  return toUniqueList(
    labels
      .map((label) => normalizeLabel(label))
      .filter((label): label is string => Boolean(label))
  )
}

function extractPrereleaseFlag(candidate: GithubCaptureCandidate): boolean {
  const metadata = candidate.metadata
  if (!metadata || typeof metadata !== "object") return false
  return (metadata as { prerelease?: unknown }).prerelease === true
}

function eventSupportsBranchFilter(eventName: GithubCaptureEvent): boolean {
  return eventName === "pull_request" || eventName === "push" || eventName === "release"
}

function eventSupportsLabelFilter(eventName: GithubCaptureEvent): boolean {
  return eventName === "pull_request" || eventName === "issues"
}

export function filterGithubCaptureCandidatesBySettings(
  candidates: GithubCaptureCandidate[],
  settings: GithubCaptureSettings
): { accepted: GithubCaptureCandidate[]; dropped: number; reasons: Record<string, number> } {
  const accepted: GithubCaptureCandidate[] = []
  const reasons: Record<string, number> = {}

  const addReason = (reason: string) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1
  }

  for (const candidate of candidates) {
    if (!settings.allowed_events.includes(candidate.sourceEvent)) {
      addReason("event_not_allowed")
      continue
    }

    const repoName = normalizeRepoName(candidate.repoFullName)
    if (!repoName) {
      addReason("invalid_repo")
      continue
    }

    if (settings.repo_block_list.length > 0 && matchesAny(settings.repo_block_list, repoName)) {
      addReason("repo_blocked")
      continue
    }

    if (settings.repo_allow_list.length > 0 && !matchesAny(settings.repo_allow_list, repoName)) {
      addReason("repo_not_allowed")
      continue
    }

    if (settings.actor_filters.length > 0) {
      const actor = normalizeActor(candidate.actorLogin ?? "")
      if (!actor || !matchesAny(settings.actor_filters, actor)) {
        addReason("actor_not_allowed")
        continue
      }
    }

    if (settings.branch_filters.length > 0 && eventSupportsBranchFilter(candidate.sourceEvent)) {
      const branch = extractBranch(candidate)
      if (!branch || !matchesAny(settings.branch_filters, branch)) {
        addReason("branch_not_allowed")
        continue
      }
    }

    if (settings.label_filters.length > 0 && eventSupportsLabelFilter(candidate.sourceEvent)) {
      const labels = extractLabels(candidate)
      const hasAllowedLabel = labels.some((label) => matchesAny(settings.label_filters, label))
      if (!hasAllowedLabel) {
        addReason("label_not_allowed")
        continue
      }
    }

    if (
      candidate.sourceEvent === "release" &&
      extractPrereleaseFlag(candidate) &&
      !settings.include_prerelease
    ) {
      addReason("prerelease_blocked")
      continue
    }

    accepted.push(candidate)
  }

  return {
    accepted,
    dropped: candidates.length - accepted.length,
    reasons,
  }
}
