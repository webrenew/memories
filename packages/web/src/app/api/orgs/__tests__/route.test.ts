import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: vi.fn().mockResolvedValue(null),
}))

import { GET, POST } from "../route"

describe("/api/orgs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("GET", () => {
    it("should return 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })
      const response = await GET()
      expect(response.status).toBe(401)
    })

    it("should return user organizations", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockFrom.mockReturnValue({
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

      const response = await GET()
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.organizations).toHaveLength(1)
      expect(body.organizations[0].name).toBe("My Team")
      expect(body.organizations[0].role).toBe("owner")
    })

    it("should return empty array when no orgs", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      })

      const response = await GET()
      const body = await response.json()
      expect(body.organizations).toEqual([])
    })

    it("should return 500 on DB error", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "DB connection failed" },
          }),
        }),
      })

      const response = await GET()
      expect(response.status).toBe(500)
    })
  })

  describe("POST", () => {
    it("should return 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })

      const request = new Request("https://example.com/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name: "New Team" }),
        headers: { "content-type": "application/json" },
      })

      const response = await POST(request)
      expect(response.status).toBe(401)
    })

    it("should return 400 for invalid name", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

      const request = new Request("https://example.com/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name: "A" }),
        headers: { "content-type": "application/json" },
      })

      const response = await POST(request)
      expect(response.status).toBe(400)
    })

    it("should create organization with unique slug", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

      // First call: slug check (no existing)
      // Second call: insert org
      // Third call: insert member
      // Fourth call: update user current_org_id
      let callCount = 0
      mockFrom.mockImplementation((table: string) => {
        if (table === "organizations") {
          callCount++
          if (callCount === 1) {
            // Slug uniqueness check
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            }
          }
          // Insert org
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "org-new", name: "New Team", slug: "new-team" },
                  error: null,
                }),
              }),
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
    })
  })
})
