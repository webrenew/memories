import { createHmac } from "node:crypto"

export type GithubCaptureEvent = "pull_request" | "issues" | "push" | "release"

export type CaptureTargetWorkspace =
  | {
      ownerType: "user"
      userId: string
      orgId: null
    }
  | {
      ownerType: "organization"
      userId: null
      orgId: string
    }

export interface GithubCaptureCandidate {
  sourceEvent: GithubCaptureEvent
  sourceAction: string | null
  sourceId: string
  repoFullName: string
  projectId: string
  actorLogin: string | null
  title: string | null
  content: string
  sourceUrl: string | null
  dedupKey: string
  metadata: Record<string, unknown>
}

interface GithubRepositoryPayload {
  id?: number
  full_name?: string
  html_url?: string
  owner?: {
    login?: string
  }
}

interface GithubActorPayload {
  login?: string
}

interface GithubPullRequestPayload {
  number?: number
  title?: string
  body?: string | null
  html_url?: string
  state?: string
  draft?: boolean
  merged?: boolean
  merged_at?: string | null
  updated_at?: string | null
  head?: {
    sha?: string
  }
  user?: GithubActorPayload
}

interface GithubIssuePayload {
  number?: number
  title?: string
  body?: string | null
  html_url?: string
  state?: string
  updated_at?: string | null
  user?: GithubActorPayload
  labels?: Array<{
    name?: string
  }>
}

interface GithubCommitPayload {
  id?: string
  message?: string
  url?: string
  timestamp?: string
  distinct?: boolean
  author?: {
    username?: string
    name?: string
  }
}

interface GithubPushPayload {
  ref?: string
  before?: string
  after?: string
  compare?: string
  commits?: GithubCommitPayload[]
  head_commit?: GithubCommitPayload | null
  pusher?: {
    name?: string
  }
}

interface GithubReleasePayload {
  id?: number
  tag_name?: string
  target_commitish?: string
  name?: string
  body?: string | null
  html_url?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string | null
  created_at?: string | null
  author?: GithubActorPayload
}

interface GithubWebhookPayload {
  action?: string
  repository?: GithubRepositoryPayload
  sender?: GithubActorPayload
  pull_request?: GithubPullRequestPayload
  issue?: GithubIssuePayload
  push?: GithubPushPayload
  ref?: string
  before?: string
  after?: string
  compare?: string
  commits?: GithubCommitPayload[]
  head_commit?: GithubCommitPayload | null
  pusher?: {
    name?: string
  }
  release?: GithubReleasePayload
}

interface AuthIdentityLike {
  provider?: unknown
  provider_id?: unknown
  identity_data?: {
    user_name?: unknown
    preferred_username?: unknown
    login?: unknown
    id?: unknown
  } | null
}

interface AuthUserLike {
  identities?: AuthIdentityLike[] | null
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeGithubLogin(value: unknown): string | null {
  const login = asNonEmptyString(value)
  if (!login) return null
  return login.toLowerCase()
}

function normalizeRepoFullName(value: unknown): string | null {
  const fullName = asNonEmptyString(value)
  if (!fullName) return null

  const normalized = fullName
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .toLowerCase()

  const parts = normalized.split("/").filter(Boolean)
  if (parts.length !== 2) return null

  return `${parts[0]}/${parts[1]}`
}

function toProjectId(repoFullName: string): string {
  return `github.com/${repoFullName}`
}

function clip(value: string | null | undefined, maxChars: number): string {
  const text = value?.trim() ?? ""
  if (!text) return ""
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 1)}…`
}

function composeContent(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n")
}

function normalizeBranchRef(ref: string | null | undefined): string | null {
  const raw = asNonEmptyString(ref)
  if (!raw) return null
  return raw.replace(/^refs\/heads\//, "")
}

function normalizeLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return []
  return Array.from(
    new Set(
      labels
        .map((label) => {
          if (typeof label === "object" && label !== null && "name" in label) {
            return normalizeGithubLogin((label as Record<string, unknown>).name)
          }
          return null
        })
        .filter((label): label is string => Boolean(label)),
    ),
  )
}

function buildDedupKey(parts: Array<string | null | undefined>): string {
  const joined = parts.map((part) => (part ?? "").trim().toLowerCase()).join("|")
  return createHmac("sha256", "github-capture").update(joined).digest("hex")
}

function parseRepository(payload: GithubWebhookPayload): {
  repoFullName: string
  projectId: string
  repoId: string
  repoUrl: string | null
  ownerLogin: string | null
} | null {
  const repo = payload.repository
  const repoFullName = normalizeRepoFullName(repo?.full_name)
  if (!repoFullName) return null

  return {
    repoFullName,
    projectId: toProjectId(repoFullName),
    repoId: String(repo?.id ?? repoFullName),
    repoUrl: asNonEmptyString(repo?.html_url),
    ownerLogin: normalizeGithubLogin(repo?.owner?.login),
  }
}

export function extractGithubAccountLink(user: AuthUserLike): {
  githubLogin: string
  githubUserId: string | null
} | null {
  if (!Array.isArray(user.identities)) return null

  for (const identity of user.identities) {
    if (identity.provider !== "github") continue

    const login =
      normalizeGithubLogin(identity.identity_data?.user_name) ??
      normalizeGithubLogin(identity.identity_data?.preferred_username) ??
      normalizeGithubLogin(identity.identity_data?.login)

    if (!login) continue

    const githubUserId =
      asNonEmptyString(identity.provider_id) ?? asNonEmptyString(identity.identity_data?.id) ?? null

    return {
      githubLogin: login,
      githubUserId,
    }
  }

  return null
}

export function verifyGithubWebhookSignature(params: {
  payload: string
  signatureHeader: string | null
  secret: string | null | undefined
}): boolean {
  const { payload, signatureHeader, secret } = params
  if (!secret || !signatureHeader) return false

  const trimmed = signatureHeader.trim()
  if (!trimmed.startsWith("sha256=")) return false

  const expected = createHmac("sha256", secret).update(payload).digest("hex")
  const provided = trimmed.slice("sha256=".length)

  if (provided.length !== expected.length) return false

  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index)
  }

  return mismatch === 0
}

export function inferTargetOwnerLogin(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const repo = parseRepository(payload as GithubWebhookPayload)
  if (!repo) return null
  return repo.ownerLogin
}

export function buildGithubCaptureCandidates(
  eventName: string,
  payloadInput: unknown
): GithubCaptureCandidate[] {
  if (!payloadInput || typeof payloadInput !== "object") return []

  const payload = payloadInput as GithubWebhookPayload
  const repo = parseRepository(payload)
  if (!repo) return []

  if (eventName === "pull_request") {
    const pr = payload.pull_request
    if (!pr || typeof pr !== "object") return []

    const prNumber = typeof pr.number === "number" ? pr.number : null
    if (!prNumber) return []

    const action = asNonEmptyString(payload.action)
    const title = clip(pr.title, 180)
    const body = clip(pr.body, 2400)
    const state = asNonEmptyString(pr.state) ?? "unknown"
    const actor =
      normalizeGithubLogin(payload.sender?.login) ??
      normalizeGithubLogin(pr.user?.login) ??
      normalizeGithubLogin(repo.ownerLogin)
    const headSha = asNonEmptyString(pr.head?.sha)
    const labels = normalizeLabels((pr as { labels?: unknown }).labels)
    const branch = normalizeBranchRef((payload as { pull_request?: { base?: { ref?: string } } })
      .pull_request?.base?.ref)

    const content = composeContent([
      `PR #${prNumber} (${state}) in ${repo.projectId}`,
      title ? `Title: ${title}` : "",
      action ? `Action: ${action}` : "",
      pr.draft === true ? "Draft: true" : "",
      pr.merged === true ? "Merged: true" : "",
      branch ? `Branch: ${branch}` : "",
      labels.length > 0 ? `Labels: ${labels.join(", ")}` : "",
      body ? `Summary: ${body}` : "",
      pr.html_url ? `URL: ${pr.html_url}` : repo.repoUrl ? `Repo: ${repo.repoUrl}` : "",
    ])

    return [
      {
        sourceEvent: "pull_request",
        sourceAction: action,
        sourceId: `pr:${repo.repoId}:${prNumber}`,
        repoFullName: repo.repoFullName,
        projectId: repo.projectId,
        actorLogin: actor,
        title: title || `PR #${prNumber}`,
        content,
        sourceUrl: asNonEmptyString(pr.html_url) ?? repo.repoUrl,
        dedupKey: buildDedupKey([
          "pull_request",
          repo.repoFullName,
          String(prNumber),
          action,
          headSha,
          asNonEmptyString(pr.updated_at),
        ]),
        metadata: {
          number: prNumber,
          state,
          draft: Boolean(pr.draft),
          merged: Boolean(pr.merged),
          merged_at: pr.merged_at ?? null,
          head_sha: headSha,
          labels,
          branch,
        },
      },
    ]
  }

  if (eventName === "issues") {
    const issue = payload.issue
    if (!issue || typeof issue !== "object") return []

    const issueNumber = typeof issue.number === "number" ? issue.number : null
    if (!issueNumber) return []

    const action = asNonEmptyString(payload.action)
    const title = clip(issue.title, 180)
    const body = clip(issue.body, 2400)
    const state = asNonEmptyString(issue.state) ?? "unknown"
    const labels = normalizeLabels(issue.labels)
    const actor =
      normalizeGithubLogin(payload.sender?.login) ??
      normalizeGithubLogin(issue.user?.login) ??
      normalizeGithubLogin(repo.ownerLogin)

    const content = composeContent([
      `Issue #${issueNumber} (${state}) in ${repo.projectId}`,
      title ? `Title: ${title}` : "",
      action ? `Action: ${action}` : "",
      labels.length > 0 ? `Labels: ${labels.join(", ")}` : "",
      body ? `Summary: ${body}` : "",
      issue.html_url ? `URL: ${issue.html_url}` : repo.repoUrl ? `Repo: ${repo.repoUrl}` : "",
    ])

    return [
      {
        sourceEvent: "issues",
        sourceAction: action,
        sourceId: `issue:${repo.repoId}:${issueNumber}`,
        repoFullName: repo.repoFullName,
        projectId: repo.projectId,
        actorLogin: actor,
        title: title || `Issue #${issueNumber}`,
        content,
        sourceUrl: asNonEmptyString(issue.html_url) ?? repo.repoUrl,
        dedupKey: buildDedupKey([
          "issues",
          repo.repoFullName,
          String(issueNumber),
          action,
          asNonEmptyString(issue.updated_at),
        ]),
        metadata: {
          number: issueNumber,
          state,
          labels,
        },
      },
    ]
  }

  if (eventName === "push") {
    const pushPayload = payload as GithubPushPayload & GithubWebhookPayload
    const commits = Array.isArray(pushPayload.commits) ? pushPayload.commits : []
    const action = "committed"
    const actor =
      normalizeGithubLogin(payload.sender?.login) ??
      normalizeGithubLogin(repo.ownerLogin) ??
      asNonEmptyString(pushPayload.pusher?.name)?.toLowerCase() ??
      null

    return commits
      .filter((commit) => Boolean(asNonEmptyString(commit.id)) && Boolean(asNonEmptyString(commit.message)))
      .slice(0, 25)
      .map((commit) => {
        const commitId = asNonEmptyString(commit.id)!
        const shortSha = commitId.slice(0, 12)
        const message = clip(commit.message, 400)
        const commitActor =
          normalizeGithubLogin(commit.author?.username) ??
          asNonEmptyString(commit.author?.name)?.toLowerCase() ??
          actor

        const branch = normalizeBranchRef(asNonEmptyString(pushPayload.ref))
        const content = composeContent([
          `Commit ${shortSha} in ${repo.projectId}`,
          message ? `Message: ${message}` : "",
          branch ? `Branch: ${branch}` : asNonEmptyString(pushPayload.ref) ? `Ref: ${pushPayload.ref}` : "",
          commit.url ? `URL: ${commit.url}` : pushPayload.compare ? `Compare: ${pushPayload.compare}` : "",
        ])

        return {
          sourceEvent: "push" as const,
          sourceAction: action,
          sourceId: `commit:${repo.repoId}:${commitId}`,
          repoFullName: repo.repoFullName,
          projectId: repo.projectId,
          actorLogin: commitActor,
          title: `Commit ${shortSha}`,
          content,
          sourceUrl: asNonEmptyString(commit.url) ?? asNonEmptyString(pushPayload.compare) ?? repo.repoUrl,
          dedupKey: buildDedupKey([
            "push",
            repo.repoFullName,
            commitId,
            asNonEmptyString(pushPayload.after),
          ]),
          metadata: {
            ref: pushPayload.ref ?? null,
            before: pushPayload.before ?? null,
            after: pushPayload.after ?? null,
            commit_timestamp: commit.timestamp ?? null,
            distinct: commit.distinct ?? null,
            branch,
          },
        }
      })
  }

  if (eventName === "release") {
    const release = payload.release
    if (!release || typeof release !== "object") return []

    const action = asNonEmptyString(payload.action)
    const releaseId = typeof release.id === "number" ? String(release.id) : null
    const tagName = asNonEmptyString(release.tag_name)
    if (!releaseId && !tagName) return []

    const actor =
      normalizeGithubLogin(payload.sender?.login) ??
      normalizeGithubLogin(release.author?.login) ??
      normalizeGithubLogin(repo.ownerLogin)

    const releaseName = clip(release.name, 180)
    const releaseBody = clip(release.body, 3200)
    const title = releaseName || (tagName ? `Release ${tagName}` : "Release notes")
    const targetCommitish = asNonEmptyString(release.target_commitish)

    const content = composeContent([
      `${title} in ${repo.projectId}`,
      tagName ? `Tag: ${tagName}` : "",
      action ? `Action: ${action}` : "",
      targetCommitish ? `Target: ${targetCommitish}` : "",
      release.prerelease === true ? "Prerelease: true" : "",
      release.draft === true ? "Draft: true" : "",
      releaseBody ? `Notes: ${releaseBody}` : "",
      release.html_url ? `URL: ${release.html_url}` : repo.repoUrl ? `Repo: ${repo.repoUrl}` : "",
    ])

    return [
      {
        sourceEvent: "release",
        sourceAction: action,
        sourceId: `release:${repo.repoId}:${releaseId ?? tagName}`,
        repoFullName: repo.repoFullName,
        projectId: repo.projectId,
        actorLogin: actor,
        title,
        content,
        sourceUrl: asNonEmptyString(release.html_url) ?? repo.repoUrl,
        dedupKey: buildDedupKey([
          "release",
          repo.repoFullName,
          releaseId ?? tagName,
          action,
          asNonEmptyString(release.published_at),
          asNonEmptyString(release.created_at),
        ]),
        metadata: {
          release_id: releaseId,
          tag_name: tagName,
          target_commitish: targetCommitish,
          draft: Boolean(release.draft),
          prerelease: Boolean(release.prerelease),
          published_at: release.published_at ?? null,
          created_at: release.created_at ?? null,
        },
      },
    ]
  }

  return []
}
