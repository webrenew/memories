import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetUser = vi.fn()
const mockAdminFrom = vi.fn()
const mockAdminGetUserById = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
    auth: { admin: { getUserById: mockAdminGetUserById } },
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  publicRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: vi.fn().mockResolvedValue(null),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}))

import { POST } from "../route"

function makeRequest(body: unknown): Request {
  return new Request("https://example.com/api/auth/cli", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

const VALID_CODE = "a".repeat(32)

describe("POST /api/auth/cli", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminGetUserById.mockResolvedValue({ data: { user: { email: "fallback@example.com" } } })
  })

  describe("poll action", () => {
    it("returns 202 when code has not been approved", async () => {
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      })

      const response = await POST(makeRequest({ action: "poll", code: VALID_CODE }))
      expect(response.status).toBe(202)
      await expect(response.json()).resolves.toEqual({ status: "pending" })
    })

    it("returns a CLI token after consuming an approved code", async () => {
      const finalize = vi.fn().mockResolvedValue({ data: { id: "user-1" }, error: null })
      const selectUser = vi.fn().mockResolvedValue({
        data: {
          id: "user-1",
          email: "user@example.com",
          cli_auth_expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
        error: null,
      })

      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: selectUser,
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: finalize,
              }),
            }),
          }),
        }),
      })

      const response = await POST(makeRequest({ action: "poll", code: VALID_CODE }))
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.email).toBe("user@example.com")
      expect(body.token).toMatch(/^cli_[a-f0-9]{64}$/)
    })

    it("returns 410 when the approved code has expired", async () => {
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "user-1",
                email: "user@example.com",
                cli_auth_expires_at: new Date(Date.now() - 1_000).toISOString(),
              },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      })

      const response = await POST(makeRequest({ action: "poll", code: VALID_CODE }))
      expect(response.status).toBe(410)
    })

    it("returns 500 when poll lookup fails", async () => {
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "DB read failed" },
            }),
          }),
        }),
      })

      const response = await POST(makeRequest({ action: "poll", code: VALID_CODE }))
      expect(response.status).toBe(500)
    })

    it("returns 500 when token finalization fails", async () => {
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "user-1",
                email: "user@example.com",
                cli_auth_expires_at: new Date(Date.now() + 60_000).toISOString(),
              },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "DB update failed" },
                }),
              }),
            }),
          }),
        }),
      })

      const response = await POST(makeRequest({ action: "poll", code: VALID_CODE }))
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toContain("finalize token exchange")
    })
  })

  describe("approve action", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const response = await POST(makeRequest({ action: "approve", code: VALID_CODE }))
      expect(response.status).toBe(401)
    })

    it("stores auth code and expiry for authenticated user", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      const eq = vi.fn().mockResolvedValue({ error: null })
      const update = vi.fn().mockReturnValue({ eq })
      mockAdminFrom.mockReturnValue({ update })

      const response = await POST(makeRequest({ action: "approve", code: VALID_CODE }))
      expect(response.status).toBe(200)

      const payload = update.mock.calls[0]?.[0]
      expect(payload.cli_auth_code).toBe(VALID_CODE)
      expect(typeof payload.cli_auth_expires_at).toBe("string")
    })
  })
})
