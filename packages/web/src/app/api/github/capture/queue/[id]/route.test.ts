import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetUser,
  mockFrom,
  mockCheckRateLimit,
  mockAddMemoryPayload,
  mockEnsureMemoryUserIdSchema,
  mockCreateTurso,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockAddMemoryPayload: vi.fn(),
  mockEnsureMemoryUserIdSchema: vi.fn(),
  mockCreateTurso: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/memory-service/mutations", () => ({
  addMemoryPayload: mockAddMemoryPayload,
}))

vi.mock("@/lib/memory-service/tools", () => ({
  ensureMemoryUserIdSchema: mockEnsureMemoryUserIdSchema,
}))

vi.mock("@libsql/client", () => ({
  createClient: mockCreateTurso,
}))

import { PATCH } from "./route"

describe("/api/github/capture/queue/[id] PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockCreateTurso.mockReturnValue({})
    mockEnsureMemoryUserIdSchema.mockResolvedValue(undefined)
    mockAddMemoryPayload.mockResolvedValue({
      data: { id: "mem-1" },
    })
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await PATCH(
      new Request("https://example.com/api/github/capture/queue/q-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "reject" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "q-1" }) }
    )

    expect(response.status).toBe(401)
  })

  it("returns 500 with stable error when queue item lookup fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    mockFrom.mockImplementation((table: string) => {
      if (table === "github_capture_queue") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "db timeout" },
              }),
            }),
          })),
        }
      }

      return {}
    })

    const response = await PATCH(
      new Request("https://example.com/api/github/capture/queue/q-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "reject" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "q-1" }) }
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Failed to load capture queue item",
    })
  })

  it("rejects pending user queue item", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    const mockUpdate = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))

    let githubQueueReadUsed = false

    mockFrom.mockImplementation((table: string) => {
      if (table === "github_capture_queue" && !githubQueueReadUsed) {
        githubQueueReadUsed = true
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "q-1",
                  target_owner_type: "user",
                  target_user_id: "user-1",
                  target_org_id: null,
                  status: "pending",
                  source_event: "issues",
                  source_action: "opened",
                  repo_full_name: "webrenew/memories",
                  project_id: "github.com/webrenew/memories",
                  actor_login: "charles",
                  source_id: "issue:1:2",
                  title: "Issue",
                  content: "Issue content",
                  source_url: "https://github.com/webrenew/memories/issues/2",
                  metadata: {},
                },
                error: null,
              }),
            }),
          })),
        }
      }

      if (table === "github_capture_queue") {
        return {
          update: mockUpdate,
        }
      }

      return {}
    })

    const response = await PATCH(
      new Request("https://example.com/api/github/capture/queue/q-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "reject", note: "noise" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "q-1" }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: "rejected" })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "rejected",
        reviewed_by: "user-1",
        decision_note: "noise",
      })
    )
  })

  it("returns 500 with stable error when reject update fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    const mockUpdate = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({
        error: { message: "db timeout" },
      }),
    }))

    let githubQueueReadUsed = false

    mockFrom.mockImplementation((table: string) => {
      if (table === "github_capture_queue" && !githubQueueReadUsed) {
        githubQueueReadUsed = true
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "q-1",
                  target_owner_type: "user",
                  target_user_id: "user-1",
                  target_org_id: null,
                  status: "pending",
                  source_event: "issues",
                  source_action: "opened",
                  repo_full_name: "webrenew/memories",
                  project_id: "github.com/webrenew/memories",
                  actor_login: "charles",
                  source_id: "issue:1:2",
                  title: "Issue",
                  content: "Issue content",
                  source_url: "https://github.com/webrenew/memories/issues/2",
                  metadata: {},
                },
                error: null,
              }),
            }),
          })),
        }
      }

      if (table === "github_capture_queue") {
        return {
          update: mockUpdate,
        }
      }

      return {}
    })

    const response = await PATCH(
      new Request("https://example.com/api/github/capture/queue/q-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "reject", note: "noise" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "q-1" }) }
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Failed to update capture queue item",
    })
  })

  it("returns 500 with stable error when approve update fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    let githubQueueReadUsed = false

    mockFrom.mockImplementation((table: string) => {
      if (table === "github_capture_queue" && !githubQueueReadUsed) {
        githubQueueReadUsed = true
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "q-1",
                  target_owner_type: "user",
                  target_user_id: "user-1",
                  target_org_id: null,
                  status: "pending",
                  source_event: "issues",
                  source_action: "opened",
                  repo_full_name: "webrenew/memories",
                  project_id: "github.com/webrenew/memories",
                  actor_login: "charles",
                  source_id: "issue:1:2",
                  title: "Issue",
                  content: "Issue content",
                  source_url: "https://github.com/webrenew/memories/issues/2",
                  metadata: {},
                },
                error: null,
              }),
            }),
          })),
        }
      }

      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  turso_db_url: "libsql://db",
                  turso_db_token: "token",
                  turso_db_name: "db-name",
                },
                error: null,
              }),
            }),
          })),
        }
      }

      if (table === "github_capture_queue") {
        return {
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              error: { message: "update failed" },
            }),
          })),
        }
      }

      return {}
    })

    const response = await PATCH(
      new Request("https://example.com/api/github/capture/queue/q-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", note: "looks good" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "q-1" }) }
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Failed to update capture queue item",
    })
  })
})
