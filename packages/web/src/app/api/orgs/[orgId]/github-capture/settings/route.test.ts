import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetUser,
  mockFrom,
  mockCheckRateLimit,
  mockLogOrgAuditEvent,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockLogOrgAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/org-audit", () => ({
  logOrgAuditEvent: mockLogOrgAuditEvent,
}))

import { GET, PATCH } from "./route"

function createMembershipSelect(role: "owner" | "admin" | "member") {
  return {
    select: vi.fn(() => ({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { role }, error: null }),
        }),
      }),
    })),
  }
}

function createSettingsSelect(rows: Record<string, unknown>[] = []) {
  return {
    select: vi.fn(() => {
      const chain = {
        eq: vi.fn(() => chain),
        limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }

      return chain
    }),
  }
}

describe("/api/orgs/[orgId]/github-capture/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns default settings when org has no capture policy row", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return createMembershipSelect("owner")
      }

      if (table === "github_capture_settings") {
        return createSettingsSelect([])
      }

      return {}
    })

    const response = await GET(new Request("https://example.com/api/orgs/org-1/github-capture/settings"), {
      params: Promise.resolve({ orgId: "org-1" }),
    })

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.configured).toBe(false)
    expect(body.settings).toMatchObject({
      allowed_events: ["pull_request", "issues", "push", "release"],
      include_prerelease: true,
    })
  })

  it("returns 500 when GET membership lookup fails", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "DB read failed" },
                }),
              }),
            }),
          })),
        }
      }

      return {}
    })

    const response = await GET(new Request("https://example.com/api/orgs/org-1/github-capture/settings"), {
      params: Promise.resolve({ orgId: "org-1" }),
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to load settings",
    })
  })

  it("saves normalized org capture policy", async () => {
    const insertedRow = {
      id: "settings-1",
      allowed_events: ["pull_request", "push"],
      repo_allow_list: ["webrenew/memories"],
      repo_block_list: ["webrenew/private"],
      branch_filters: ["main", "release/*"],
      label_filters: ["memory", "docs"],
      actor_filters: ["charles", "bot-*"],
      include_prerelease: false,
      updated_at: "2026-02-13T00:00:00.000Z",
    }

    let settingsSelectCount = 0

    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return createMembershipSelect("owner")
      }

      if (table === "github_capture_settings") {
        settingsSelectCount += 1

        if (settingsSelectCount === 1) {
          return createSettingsSelect([])
        }

        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: insertedRow, error: null }),
            })),
          })),
        }
      }

      return {}
    })

    const response = await PATCH(
      new Request("https://example.com/api/orgs/org-1/github-capture/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allowed_events: ["pr", "push"],
          repo_allow_list: ["https://github.com/webrenew/memories"],
          repo_block_list: ["WebRenew/private.git"],
          branch_filters: ["refs/heads/main", "release/*"],
          label_filters: ["memory", "docs"],
          actor_filters: ["@charles", "bot-*"],
          include_prerelease: false,
        }),
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.settings).toMatchObject({
      allowed_events: ["pull_request", "push"],
      repo_allow_list: ["webrenew/memories"],
      repo_block_list: ["webrenew/private"],
      branch_filters: ["main", "release/*"],
      label_filters: ["memory", "docs"],
      actor_filters: ["charles", "bot-*"],
      include_prerelease: false,
    })

    expect(mockLogOrgAuditEvent).toHaveBeenCalledTimes(1)
  })

  it("returns 500 when PATCH membership lookup fails", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "DB read failed" },
                }),
              }),
            }),
          })),
        }
      }

      return {}
    })

    const response = await PATCH(
      new Request("https://example.com/api/orgs/org-1/github-capture/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ include_prerelease: false }),
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to save settings",
    })
  })
})
