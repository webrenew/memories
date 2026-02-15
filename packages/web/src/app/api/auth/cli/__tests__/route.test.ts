import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGetUser = vi.fn()
const mockAdminFrom = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
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
  })

  describe("poll action", () => {
    it("should return 202 when token not yet available", async () => {
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      })

      const response = await POST(makeRequest({ action: "poll", code: VALID_CODE }))
      expect(response.status).toBe(202)

      const body = await response.json()
      expect(body.status).toBe("pending")
    })

    it("should return token when available", async () => {
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { cli_token: "cli_abc123", email: "user@example.com" },
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      })

      const response = await POST(makeRequest({ action: "poll", code: VALID_CODE }))
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.token).toBe("cli_abc123")
      expect(body.email).toBe("user@example.com")
    })

    it("should return 500 when poll lookup fails", async () => {
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
      const body = await response.json()
      expect(body.error).toContain("check auth status")
    })

    it("should return 500 when clearing auth code fails after token retrieval", async () => {
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { cli_token: "cli_abc123", email: "user@example.com" },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: "DB update failed" } }),
        }),
      })

      const response = await POST(makeRequest({ action: "poll", code: VALID_CODE }))
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toContain("finalize token exchange")
    })

    it("should return 400 for invalid code format", async () => {
      const response = await POST(makeRequest({ action: "poll", code: "short" }))
      expect(response.status).toBe(400)
    })
  })

  describe("approve action", () => {
    it("should return 401 when not authenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const response = await POST(makeRequest({ action: "approve", code: VALID_CODE }))
      expect(response.status).toBe(401)
    })

    it("should approve and generate CLI token", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockAdminFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      })

      const response = await POST(makeRequest({ action: "approve", code: VALID_CODE }))
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.ok).toBe(true)
    })

    it("should return 500 on DB failure", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockAdminFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: "DB error" } }),
        }),
      })

      const response = await POST(makeRequest({ action: "approve", code: VALID_CODE }))
      expect(response.status).toBe(500)
    })
  })

  describe("invalid action", () => {
    it("should return 400 for unknown action", async () => {
      const response = await POST(makeRequest({ action: "unknown" }))
      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error).toBe("Invalid action")
    })

    it("should return 400 for malformed JSON", async () => {
      const request = new Request("https://example.com/api/auth/cli", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      })

      const response = await POST(request)
      expect(response.status).toBe(400)
    })
  })
})
