import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Supabase
const mockGetUser = vi.fn()
const mockSelect = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockReturnValue(mockSelect()),
        }),
      }),
    }),
  })),
}))

// Mock Turso
const mockExecute = vi.fn()
vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: mockExecute,
  })),
}))

// Mock rate limiting (already mocked globally in setup, but override for specific behavior)
vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: vi.fn().mockResolvedValue(null),
}))

import { GET, POST, PATCH, DELETE } from "../route"
import { NextRequest } from "next/server"

function makeRequest(method: string, body?: unknown): NextRequest {
  if (body) {
    return new NextRequest("https://example.com/api/memories", {
      method,
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  }
  return new NextRequest("https://example.com/api/memories", { method })
}

describe("/api/memories", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("auth checks", () => {
    it("GET should return 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })
      const response = await GET(makeRequest("GET"))
      expect(response.status).toBe(401)
    })

    it("POST should return 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })
      const request = makeRequest("POST", { content: "test" })
      const response = await POST(request)
      expect(response.status).toBe(401)
    })

    it("PATCH should return 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })
      const request = makeRequest("PATCH", { id: "123", content: "test" })
      const response = await PATCH(request)
      expect(response.status).toBe(401)
    })

    it("DELETE should return 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })
      const request = makeRequest("DELETE", { id: "123" })
      const response = await DELETE(request)
      expect(response.status).toBe(401)
    })
  })

  describe("GET", () => {
    it("should return 400 when Turso is not configured", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockSelect.mockReturnValue({ data: null })

      const response = await GET(makeRequest("GET"))
      expect(response.status).toBe(400)
    })

    it("should return memories when properly configured", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockSelect.mockReturnValue({
        data: { turso_db_url: "libsql://test.turso.io", turso_db_token: "token" },
      })
      mockExecute.mockResolvedValue({
        rows: [{ id: "m1", content: "test memory", type: "rule" }],
      })

      const response = await GET(makeRequest("GET"))
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.memories).toBeDefined()
    })
  })

  describe("POST", () => {
    it("should return 400 for invalid body", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      const request = makeRequest("POST", { content: "" })
      const response = await POST(request)
      expect(response.status).toBe(400)
    })

    it("should create memory when valid", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockSelect.mockReturnValue({
        data: { turso_db_url: "libsql://test.turso.io", turso_db_token: "token" },
      })
      mockExecute.mockResolvedValue({})

      const request = makeRequest("POST", { content: "New memory", type: "note" })
      const response = await POST(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.content).toBe("New memory")
      expect(body.type).toBe("note")
      expect(body.id).toBeDefined()
      expect(body.updated_at).toBeDefined()
      expect(body.paths).toBeNull()
      expect(body.category).toBeNull()
      expect(body.metadata).toBeNull()
    })

    it("should create memory with full fields", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockSelect.mockReturnValue({
        data: { turso_db_url: "libsql://test.turso.io", turso_db_token: "token" },
      })
      mockExecute.mockResolvedValue({})

      const request = makeRequest("POST", {
        content: "Use strict mode",
        type: "skill",
        scope: "project",
        project_id: "github.com/user/repo",
        paths: "src/**/*.ts",
        category: "typescript",
        metadata: '{"priority":"high"}',
      })
      const response = await POST(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.type).toBe("skill")
      expect(body.scope).toBe("project")
      expect(body.project_id).toBe("github.com/user/repo")
      expect(body.paths).toBe("src/**/*.ts")
      expect(body.category).toBe("typescript")
      expect(body.metadata).toBe('{"priority":"high"}')
    })
  })

  describe("PATCH", () => {
    it("should return 400 for invalid body", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      const request = makeRequest("PATCH", { id: "", content: "test" })
      const response = await PATCH(request)
      expect(response.status).toBe(400)
    })

    it("should update memory when valid", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockSelect.mockReturnValue({
        data: { turso_db_url: "libsql://test.turso.io", turso_db_token: "token" },
      })
      mockExecute.mockResolvedValue({})

      const request = makeRequest("PATCH", { id: "m1", content: "Updated" })
      const response = await PATCH(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.success).toBe(true)
    })
  })

  describe("DELETE", () => {
    it("should soft-delete memory", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
      mockSelect.mockReturnValue({
        data: { turso_db_url: "libsql://test.turso.io", turso_db_token: "token" },
      })
      mockExecute.mockResolvedValue({})

      const request = makeRequest("DELETE", { id: "m1" })
      const response = await DELETE(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.success).toBe(true)
    })
  })
})
