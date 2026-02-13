import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHmac } from "node:crypto"

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

import { POST } from "../route"

function signPayload(payload: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(payload).digest("hex")
  return `sha256=${digest}`
}

describe("/api/github/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret"
  })

  it("returns 401 for invalid signature", async () => {
    const payload = JSON.stringify({ repository: { full_name: "WebRenew/memories", owner: { login: "WebRenew" } } })

    const request = new Request("https://example.com/api/github/webhook", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=invalid",
        "content-type": "application/json",
      },
      body: payload,
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it("enqueues pull request capture for mapped organization", async () => {
    const payload = JSON.stringify({
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
        title: "Add queue",
        body: "Queue with approvals",
        html_url: "https://github.com/WebRenew/memories/pull/42",
        state: "open",
        updated_at: "2026-02-12T00:00:00.000Z",
        head: { sha: "abcdef123456" },
      },
    })

    const mockInsert = vi.fn().mockResolvedValue({ error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "org-1", slug: "webrenew" },
                error: null,
              }),
            }),
          })),
        }
      }

      if (table === "github_capture_queue") {
        return {
          insert: mockInsert,
        }
      }

      if (table === "github_account_links") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
            }),
          })),
        }
      }

      return {}
    })

    const request = new Request("https://example.com/api/github/webhook", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": signPayload(payload, "test-secret"),
        "content-type": "application/json",
      },
      body: payload,
    })

    const response = await POST(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.inserted).toBe(1)
    expect(body.target).toMatchObject({ ownerType: "organization", orgId: "org-1" })
    expect(mockInsert).toHaveBeenCalledTimes(1)
  })

  it("enqueues release-note capture candidates", async () => {
    const payload = JSON.stringify({
      action: "published",
      repository: {
        id: 1,
        full_name: "WebRenew/memories",
        html_url: "https://github.com/WebRenew/memories",
        owner: { login: "WebRenew" },
      },
      sender: { login: "charles" },
      release: {
        id: 99,
        tag_name: "v16.1.7",
        target_commitish: "main",
        name: "v16.1.7",
        body: "Release notes for telemetry and capture filters.",
        html_url: "https://github.com/WebRenew/memories/releases/tag/v16.1.7",
        prerelease: false,
        draft: false,
        published_at: "2026-02-13T20:00:00.000Z",
      },
    })

    const mockInsert = vi.fn().mockResolvedValue({ error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "org-1", slug: "webrenew" },
                error: null,
              }),
            }),
          })),
        }
      }

      if (table === "github_capture_queue") {
        return {
          insert: mockInsert,
        }
      }

      if (table === "github_account_links") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
            }),
          })),
        }
      }

      return {}
    })

    const request = new Request("https://example.com/api/github/webhook", {
      method: "POST",
      headers: {
        "x-github-event": "release",
        "x-hub-signature-256": signPayload(payload, "test-secret"),
        "content-type": "application/json",
      },
      body: payload,
    })

    const response = await POST(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.inserted).toBe(1)
    expect(mockInsert).toHaveBeenCalledTimes(1)
  })
})
