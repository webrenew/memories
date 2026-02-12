import { describe, expect, it } from "vitest"
import { createHmac } from "node:crypto"
import {
  buildGithubCaptureCandidates,
  extractGithubAccountLink,
  verifyGithubWebhookSignature,
} from "./github-capture"

describe("github capture helpers", () => {
  it("verifies webhook signatures", () => {
    const payload = JSON.stringify({ hello: "world" })
    const digest = createHmac("sha256", "top-secret").update(payload).digest("hex")
    const signature = `sha256=${digest}`

    expect(
      verifyGithubWebhookSignature({
        payload,
        signatureHeader: signature,
        secret: "top-secret",
      })
    ).toBe(true)

    expect(
      verifyGithubWebhookSignature({
        payload,
        signatureHeader: signature,
        secret: "wrong-secret",
      })
    ).toBe(false)
  })

  it("extracts linked github identity from auth user", () => {
    const link = extractGithubAccountLink({
      identities: [
        {
          provider: "google",
          identity_data: { preferred_username: "ignore" },
        },
        {
          provider: "github",
          provider_id: "12345",
          identity_data: {
            user_name: "WebRenew",
          },
        },
      ],
    })

    expect(link).toEqual({
      githubLogin: "webrenew",
      githubUserId: "12345",
    })
  })

  it("builds pull request capture candidates", () => {
    const candidates = buildGithubCaptureCandidates("pull_request", {
      action: "opened",
      repository: {
        id: 1,
        full_name: "WebRenew/memories",
        html_url: "https://github.com/WebRenew/memories",
        owner: { login: "WebRenew" },
      },
      sender: { login: "charles" },
      pull_request: {
        number: 42,
        title: "Improve retrieval pipeline",
        body: "Adds queue-backed approvals and webhook ingest.",
        html_url: "https://github.com/WebRenew/memories/pull/42",
        state: "open",
        draft: false,
        merged: false,
        head: { sha: "abcdef123456" },
        updated_at: "2026-02-12T00:00:00.000Z",
      },
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.sourceEvent).toBe("pull_request")
    expect(candidates[0]?.repoFullName).toBe("webrenew/memories")
    expect(candidates[0]?.projectId).toBe("github.com/webrenew/memories")
    expect(candidates[0]?.content).toContain("PR #42")
  })

  it("builds issue capture candidates", () => {
    const candidates = buildGithubCaptureCandidates("issues", {
      action: "opened",
      repository: {
        id: 1,
        full_name: "WebRenew/memories",
        owner: { login: "WebRenew" },
      },
      issue: {
        number: 17,
        title: "Queue panel is empty",
        body: "Nothing is showing in queue UI.",
        html_url: "https://github.com/WebRenew/memories/issues/17",
        state: "open",
        updated_at: "2026-02-12T00:00:00.000Z",
      },
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.sourceEvent).toBe("issues")
    expect(candidates[0]?.sourceId).toBe("issue:1:17")
    expect(candidates[0]?.title).toContain("Queue panel")
  })

  it("builds commit candidates for push events", () => {
    const candidates = buildGithubCaptureCandidates("push", {
      repository: {
        id: 9,
        full_name: "WebRenew/memories",
        owner: { login: "WebRenew" },
      },
      after: "after-sha",
      ref: "refs/heads/main",
      commits: [
        {
          id: "abcdef1234567890",
          message: "feat: add queue",
          url: "https://github.com/WebRenew/memories/commit/abcdef1234567890",
          timestamp: "2026-02-12T00:00:00.000Z",
          author: {
            username: "charles",
          },
        },
      ],
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.sourceEvent).toBe("push")
    expect(candidates[0]?.sourceId).toBe("commit:9:abcdef1234567890")
    expect(candidates[0]?.content).toContain("Commit abcdef123456")
  })
})
