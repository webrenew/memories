import { describe, it, expect, vi, beforeEach } from "vitest"

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
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: mockCheckRateLimit,
  checkPreAuthApiRateLimit: mockCheckPreAuthApiRateLimit,
}))

import { GET, POST } from "../route"

describe("/api/orgs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPreAuthApiRateLimit.mockResolvedValue(null)
    mockCheckRateLimit.mockResolvedValue(null)
  })

  describe("GET", () => {
    it("should return 401 when unauthenticated", async () => {
      mockAuthenticateRequest.mockResolvedValue(null)
      const response = await GET(new Request("https://example.com/api/orgs"))
      expect(response.status).toBe(401)
    })

    it("should return user organizations", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              {
                role: "owner",
                organization: {
                  id: "org-1",
                  name: "My Team",
                  slug: "my-team",
                  owner_id: "user-1",
                  plan: "pro",
                  created_at: "2025-01-01",
                },
              },
            ],
            error: null,
          }),
        }),
      })

      const response = await GET(new Request("https://example.com/api/orgs"))
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.organizations).toHaveLength(1)
      expect(body.organizations[0].name).toBe("My Team")
      expect(body.organizations[0].role).toBe("owner")
    })

    it("should return empty array when no orgs", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      })

      const response = await GET(new Request("https://example.com/api/orgs"))
      const body = await response.json()
      expect(body.organizations).toEqual([])
    })

    it("should return 500 on DB error", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })
      mockAdminFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "DB connection failed" },
          }),
        }),
      })

      const response = await GET(new Request("https://example.com/api/orgs"))
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toBe("Failed to load organizations")
    })
  })

  describe("POST", () => {
    it("should return 401 when unauthenticated", async () => {
      mockAuthenticateRequest.mockResolvedValue(null)

      const request = new Request("https://example.com/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name: "New Team" }),
        headers: { "content-type": "application/json" },
      })

      const response = await POST(request)
      expect(response.status).toBe(401)
    })

    it("should return 400 for invalid name", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })

      const request = new Request("https://example.com/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name: "A" }),
        headers: { "content-type": "application/json" },
      })

      const response = await POST(request)
      expect(response.status).toBe(400)
    })

    it("should create organization with unique slug", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })

      let orgCallCount = 0
      mockAdminFrom.mockImplementation((table: string) => {
        if (table === "organizations") {
          orgCallCount += 1
          if (orgCallCount === 1) {
            // Slug uniqueness check
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }
          }

          // Create org
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "org-new", name: "New Team", slug: "new-team" },
                  error: null,
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }

        if (table === "org_members") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        if (table === "users") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }

        return {}
      })

      const request = new Request("https://example.com/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name: "New Team" }),
        headers: { "content-type": "application/json" },
      })

      const response = await POST(request)
      expect(response.status).toBe(201)

      const body = await response.json()
      expect(body.organization.name).toBe("New Team")
      expect(body.organization.slug).toBe("new-team")
    })

    it("should return 500 when slug uniqueness check fails", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })

      mockAdminFrom.mockImplementation((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "DB read failed" },
                }),
              }),
            }),
          }
        }

        return {}
      })

      const request = new Request("https://example.com/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name: "New Team" }),
        headers: { "content-type": "application/json" },
      })

      const response = await POST(request)
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toBe("Failed to create organization")
    })

    it("should return 500 when organization insert fails", async () => {
      mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })

      let orgCallCount = 0
      mockAdminFrom.mockImplementation((table: string) => {
        if (table === "organizations") {
          orgCallCount += 1
          if (orgCallCount === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }
          }

          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "DB write failed" },
                }),
              }),
            }),
          }
        }

        return {}
      })

      const request = new Request("https://example.com/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name: "New Team" }),
        headers: { "content-type": "application/json" },
      })

      const response = await POST(request)
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toBe("Failed to create organization")
    })
  })
})
