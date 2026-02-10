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
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: vi.fn().mockResolvedValue(null),
}))

import { GET, POST, DELETE } from "../route"

describe("/api/mcp/key", () => {
  const validExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("auth", () => {
    it("GET should return 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })
      const response = await GET()
      expect(response.status).toBe(401)
    })

    it("POST should return 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })
      const request = new Request("http://localhost/api/mcp/key", { method: "POST" })
      const response = await POST(request)
      expect(response.status).toBe(401)
    })

    it("DELETE should return 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })
      const response = await DELETE()
      expect(response.status).toBe(401)
    })
  })

  describe("GET", () => {
    it("should return hasKey: false when no key exists", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { mcp_api_key_hash: null } }),
          }),
        }),
      })

      const response = await GET()
      const body = await response.json()
      expect(body.hasKey).toBe(false)
    })

    it("should return metadata when key exists", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                mcp_api_key_hash: "deadbeef",
                mcp_api_key_prefix: "mcp_12345678",
                mcp_api_key_last4: "abcd",
                mcp_api_key_created_at: "2026-02-10T00:00:00.000Z",
                mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
              },
            }),
          }),
        }),
      })

      const response = await GET()
      const body = await response.json()
      expect(body.hasKey).toBe(true)
      expect(body.keyPreview).toBe("mcp_12345678********************abcd")
      expect(body.apiKey).toBeUndefined()
      expect(body.expiresAt).toBe("2099-01-01T00:00:00.000Z")
      expect(body.isExpired).toBe(false)
    })
  })

  describe("POST", () => {
    it("should require expiresAt", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      const request = new Request("http://localhost/api/mcp/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain("expiresAt")
    })

    it("should generate new API key with hash + expiry metadata", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

      const mockEq = vi.fn().mockResolvedValue({ error: null })
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
      mockAdminFrom.mockReturnValue({ update: mockUpdate })

      const request = new Request("http://localhost/api/mcp/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresAt: validExpiry }),
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.apiKey).toMatch(/^mcp_[a-f0-9]{64}$/)
      expect(body.keyPreview).toMatch(/^mcp_[a-f0-9]{8}\*{20}[a-f0-9]{4}$/)
      expect(body.expiresAt).toBe(validExpiry)
      expect(body.message).toBeDefined()

      const payload = mockUpdate.mock.calls[0]?.[0]
      expect(payload.mcp_api_key).toBeNull()
      expect(payload.mcp_api_key_hash).toMatch(/^[a-f0-9]{64}$/)
      expect(payload.mcp_api_key_prefix).toMatch(/^mcp_[a-f0-9]{8}$/)
      expect(payload.mcp_api_key_last4).toMatch(/^[a-f0-9]{4}$/)
      expect(payload.mcp_api_key_expires_at).toBe(validExpiry)
    })

    it("should return 500 on DB error", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockAdminFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: "DB error" } }),
        }),
      })

      const request = new Request("http://localhost/api/mcp/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresAt: validExpiry }),
      })

      const response = await POST(request)
      expect(response.status).toBe(500)
    })
  })

  describe("DELETE", () => {
    it("should revoke API key", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

      const mockEq = vi.fn().mockResolvedValue({ error: null })
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
      mockAdminFrom.mockReturnValue({ update: mockUpdate })

      const response = await DELETE()
      const body = await response.json()
      expect(body.ok).toBe(true)

      const payload = mockUpdate.mock.calls[0]?.[0]
      expect(payload).toMatchObject({
        mcp_api_key: null,
        mcp_api_key_hash: null,
        mcp_api_key_prefix: null,
        mcp_api_key_last4: null,
        mcp_api_key_created_at: null,
        mcp_api_key_expires_at: null,
      })
    })

    it("should return 500 on revoke failure", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockAdminFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: "DB error" } }),
        }),
      })

      const response = await DELETE()
      expect(response.status).toBe(500)
    })
  })
})
