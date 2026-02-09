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
      const response = await POST()
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
            single: vi.fn().mockResolvedValue({ data: { mcp_api_key: null } }),
          }),
        }),
      })

      const response = await GET()
      const body = await response.json()
      expect(body.hasKey).toBe(false)
    })

    it("should return key when it exists", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { mcp_api_key: "mcp_test123" } }),
          }),
        }),
      })

      const response = await GET()
      const body = await response.json()
      expect(body.hasKey).toBe(true)
      expect(body.apiKey).toBe("mcp_test123")
    })
  })

  describe("POST", () => {
    it("should generate new API key", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockAdminFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      })

      const response = await POST()
      const body = await response.json()
      expect(body.apiKey).toMatch(/^mcp_/)
      expect(body.message).toBeDefined()
    })

    it("should return 500 on DB error", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockAdminFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: "DB error" } }),
        }),
      })

      const response = await POST()
      expect(response.status).toBe(500)
    })
  })

  describe("DELETE", () => {
    it("should revoke API key", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockAdminFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      })

      const response = await DELETE()
      const body = await response.json()
      expect(body.ok).toBe(true)
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
