import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockAdminFrom,
  mockCheckRateLimit,
  mockCheckPreAuthApiRateLimit,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockCheckPreAuthApiRateLimit: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
  checkPreAuthApiRateLimit: mockCheckPreAuthApiRateLimit,
}))

import { GET, PATCH } from "../route"

function makePatchRequest(body: unknown) {
  return new Request("https://example.com/api/user", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

describe("/api/user", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPreAuthApiRateLimit.mockResolvedValue(null)
    mockCheckRateLimit.mockResolvedValue(null)
  })

  describe("GET", () => {
    it("returns 401 when unauthenticated", async () => {
      mockAuthenticateRequest.mockResolvedValue(null)
      const response = await GET(new Request("https://example.com/api/user"))
      expect(response.status).toBe(401)
    })

    it("returns user profile", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: "user-1",
                email: "u@example.com",
                name: "U",
                plan: "free",
                embedding_model: "all-MiniLM-L6-v2",
                current_org_id: "org-1",
                repo_workspace_routing_mode: "auto",
                repo_owner_org_mappings: [{ owner: "acme", org_id: "org-1" }],
              },
              error: null,
            }),
          }),
        }),
      })

      const response = await GET(new Request("https://example.com/api/user"))
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.user.id).toBe("user-1")
      expect(body.user.current_org_id).toBe("org-1")
      expect(body.user.repo_workspace_routing_mode).toBe("auto")
      expect(body.user.repo_owner_org_mappings).toEqual([{ owner: "acme", org_id: "org-1" }])
    })

    it("returns 500 when profile lookup fails", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "DB read failed" },
            }),
          }),
        }),
      })

      const response = await GET(new Request("https://example.com/api/user"))
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toMatchObject({
        error: "Failed to load user profile",
      })
    })
  })

  describe("PATCH", () => {
    it("returns 401 when unauthenticated", async () => {
      mockAuthenticateRequest.mockResolvedValue(null)
      const response = await PATCH(makePatchRequest({ name: "New Name" }))
      expect(response.status).toBe(401)
    })

    it("returns 403 when switching to an org the user is not a member of", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })
      const mockInsertSwitchEvent = vi.fn().mockResolvedValue({ error: null })

      mockAdminFrom.mockImplementation((table: string) => {
        if (table === "org_members") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }
        }

        if (table === "users") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { current_org_id: null }, error: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }

        if (table === "workspace_switch_events") {
          return { insert: mockInsertSwitchEvent }
        }

        return {}
      })

      const response = await PATCH(makePatchRequest({ current_org_id: "org-1" }))
      expect(response.status).toBe(403)
      expect(mockInsertSwitchEvent).toHaveBeenCalledTimes(1)
      expect(mockInsertSwitchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          from_org_id: null,
          to_org_id: "org-1",
          success: false,
          error_code: "membership_denied",
        }),
      )
    })

    it("returns 500 when workspace switch membership lookup fails", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })
      const mockInsertSwitchEvent = vi.fn().mockResolvedValue({ error: null })

      mockAdminFrom.mockImplementation((table: string) => {
        if (table === "org_members") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: "DB read failed" },
                  }),
                }),
              }),
            }),
          }
        }

        if (table === "users") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { current_org_id: null }, error: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }

        if (table === "workspace_switch_events") {
          return { insert: mockInsertSwitchEvent }
        }

        return {}
      })

      const response = await PATCH(makePatchRequest({ current_org_id: "org-1" }))
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toMatchObject({
        error: "Failed to update user",
      })
      expect(mockInsertSwitchEvent).toHaveBeenCalledTimes(1)
      expect(mockInsertSwitchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          from_org_id: null,
          to_org_id: "org-1",
          success: false,
          error_code: "membership_lookup_failed",
        }),
      )
    })

    it("updates current_org_id when membership is valid", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
      const mockInsertSwitchEvent = vi.fn().mockResolvedValue({ error: null })

      mockAdminFrom.mockImplementation((table: string) => {
        if (table === "org_members") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "membership-1" }, error: null }),
                }),
              }),
            }),
          }
        }

        if (table === "users") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { current_org_id: null }, error: null }),
              }),
            }),
            update: mockUpdate,
          }
        }

        if (table === "workspace_switch_events") {
          return { insert: mockInsertSwitchEvent }
        }

        return {}
      })

      const response = await PATCH(makePatchRequest({ current_org_id: "org-1" }))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(typeof body.workspace_cache_bust_key).toBe("string")
      expect(mockUpdate).toHaveBeenCalledWith({ current_org_id: "org-1" })
      expect(mockInsertSwitchEvent).toHaveBeenCalledTimes(1)
      expect(mockInsertSwitchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          to_org_id: "org-1",
          success: true,
        })
      )
    })

    it("allows clearing current_org_id", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
      const mockInsertSwitchEvent = vi.fn().mockResolvedValue({ error: null })

      mockAdminFrom.mockImplementation((table: string) => {
        if (table === "users") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { current_org_id: "org-1" }, error: null }),
              }),
            }),
            update: mockUpdate,
          }
        }
        if (table === "workspace_switch_events") {
          return { insert: mockInsertSwitchEvent }
        }
        return {}
      })

      const response = await PATCH(makePatchRequest({ current_org_id: null }))
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(typeof body.workspace_cache_bust_key).toBe("string")
      expect(mockUpdate).toHaveBeenCalledWith({ current_org_id: null })
      expect(mockInsertSwitchEvent).toHaveBeenCalledTimes(1)
      expect(mockInsertSwitchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          from_org_id: "org-1",
          to_org_id: null,
          success: true,
        })
      )
    })

    it("updates repo workspace routing mode", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })

      mockAdminFrom.mockImplementation((table: string) => {
        if (table === "users") {
          return { update: mockUpdate }
        }
        return {}
      })

      const response = await PATCH(makePatchRequest({ repo_workspace_routing_mode: "active_workspace" }))
      expect(response.status).toBe(200)
      expect(mockUpdate).toHaveBeenCalledWith({ repo_workspace_routing_mode: "active_workspace" })
    })

    it("updates repo owner org mappings", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })

      mockAdminFrom.mockImplementation((table: string) => {
        if (table === "users") {
          return { update: mockUpdate }
        }
        return {}
      })

      const response = await PATCH(
        makePatchRequest({
          repo_owner_org_mappings: [
            { owner: "webrenew", org_id: "org-webrenew" },
            { owner: "acme-platform", org_id: "org-acme" },
          ],
        })
      )

      expect(response.status).toBe(200)
      expect(mockUpdate).toHaveBeenCalledWith({
        repo_owner_org_mappings: [
          { owner: "webrenew", org_id: "org-webrenew" },
          { owner: "acme-platform", org_id: "org-acme" },
        ],
      })
    })

    it("returns 500 when user update mutation fails", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: "DB write failed" } }),
      })

      mockAdminFrom.mockImplementation((table: string) => {
        if (table === "users") {
          return { update: mockUpdate }
        }
        return {}
      })

      const response = await PATCH(makePatchRequest({ repo_workspace_routing_mode: "active_workspace" }))
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toMatchObject({
        error: "Failed to update user",
      })
    })
  })
})
