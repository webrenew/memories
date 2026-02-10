import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Supabase admin
const mockAdminSelect = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockImplementation(() => mockAdminSelect()),
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

// Mock rate limiting
vi.mock("@/lib/rate-limit", () => ({
  mcpRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: vi.fn().mockResolvedValue(null),
}))

import { GET, POST, OPTIONS } from "../route"
import { NextRequest } from "next/server"

// Helpers
function makePostRequest(body: unknown, apiKey = "mcp_testkey123"): NextRequest {
  return new NextRequest("https://example.com/api/mcp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
  })
}

function makeGetRequest(apiKey?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  return new NextRequest("https://example.com/api/mcp", { method: "GET", headers })
}

function jsonrpc(method: string, params?: unknown, id = 1) {
  return { jsonrpc: "2.0", method, params, id }
}

function setupAuth() {
  mockAdminSelect.mockReturnValue({
    data: {
      id: "user-1",
      email: "test@example.com",
      turso_db_url: "libsql://test.turso.io",
      turso_db_token: "token",
    },
  })
}

describe("/api/mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- Auth & Transport ---

  describe("GET (server info & SSE)", () => {
    it("should return server info without API key", async () => {
      const response = await GET(makeGetRequest())
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.name).toBe("memories.sh MCP Server")
      expect(body.transport).toBe("sse")
    })

    it("should return 401 for invalid API key format", async () => {
      mockAdminSelect.mockReturnValue({ data: null })
      const response = await GET(makeGetRequest("invalid_key"))
      expect(response.status).toBe(401)
    })

    it("should return 400 when database not configured", async () => {
      mockAdminSelect.mockReturnValue({
        data: { id: "user-1", email: "test@example.com", turso_db_url: null, turso_db_token: null },
      })
      const response = await GET(makeGetRequest("mcp_testkey123"))
      expect(response.status).toBe(400)
    })
  })

  describe("OPTIONS (CORS)", () => {
    it("should return CORS headers", async () => {
      const response = await OPTIONS()
      expect(response.status).toBe(204)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS")
    })
  })

  describe("POST auth", () => {
    it("should return 401 without API key", async () => {
      const request = new NextRequest("https://example.com/api/mcp", {
        method: "POST",
        body: JSON.stringify(jsonrpc("initialize")),
        headers: { "content-type": "application/json" },
      })
      const response = await POST(request)
      expect(response.status).toBe(401)
    })

    it("should return 401 for invalid API key", async () => {
      mockAdminSelect.mockReturnValue({ data: null })
      const response = await POST(makePostRequest(jsonrpc("initialize")))
      expect(response.status).toBe(401)
    })
  })

  // --- JSON-RPC Methods ---

  describe("initialize", () => {
    it("should return protocol info", async () => {
      setupAuth()
      const response = await POST(makePostRequest(jsonrpc("initialize")))
      const body = await response.json()
      expect(body.result.protocolVersion).toBe("2024-11-05")
      expect(body.result.serverInfo.name).toBe("memories.sh")
      expect(body.result.capabilities.tools).toBeDefined()
    })
  })

  describe("notifications/initialized", () => {
    it("should return 204", async () => {
      setupAuth()
      const response = await POST(makePostRequest(jsonrpc("notifications/initialized")))
      expect(response.status).toBe(204)
    })
  })

  describe("tools/list", () => {
    it("should return 7 tools", async () => {
      setupAuth()
      const response = await POST(makePostRequest(jsonrpc("tools/list")))
      const body = await response.json()
      expect(body.result.tools).toHaveLength(7)

      const toolNames = body.result.tools.map((t: { name: string }) => t.name)
      expect(toolNames).toContain("get_context")
      expect(toolNames).toContain("get_rules")
      expect(toolNames).toContain("add_memory")
      expect(toolNames).toContain("edit_memory")
      expect(toolNames).toContain("forget_memory")
      expect(toolNames).toContain("search_memories")
      expect(toolNames).toContain("list_memories")
    })
  })

  describe("ping", () => {
    it("should return empty result", async () => {
      setupAuth()
      const response = await POST(makePostRequest(jsonrpc("ping")))
      const body = await response.json()
      expect(body.result).toEqual({})
    })
  })

  describe("unknown method", () => {
    it("should return -32601 error", async () => {
      setupAuth()
      const response = await POST(makePostRequest(jsonrpc("nonexistent/method")))
      const body = await response.json()
      expect(body.error.code).toBe(-32601)
      expect(body.error.message).toContain("nonexistent/method")
    })
  })

  // --- Tool Execution: get_context ---

  describe("tools/call: get_context", () => {
    it("should return rules when no query", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({
        rows: [
          { id: "r1", content: "Use TypeScript strict mode", type: "rule", scope: "global", project_id: null },
        ],
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", { name: "get_context", arguments: {} })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Global Rules")
      expect(body.result.content[0].text).toContain("Use TypeScript strict mode")
    })

    it("should split global and project rules", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({
        rows: [
          { id: "r1", content: "Global rule", type: "rule", scope: "global", project_id: null },
          { id: "r2", content: "Project rule", type: "rule", scope: "project", project_id: "github.com/user/repo" },
        ],
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", { name: "get_context", arguments: { project_id: "github.com/user/repo" } })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Global Rules")
      expect(body.result.content[0].text).toContain("Project Rules")
    })

    it("should include search results when query provided", async () => {
      setupAuth()
      // First call: rules query
      mockExecute.mockResolvedValueOnce({
        rows: [{ id: "r1", content: "Always use strict mode", type: "rule", scope: "global", project_id: null }],
      })
      // Second call: FTS5 search
      mockExecute.mockResolvedValueOnce({
        rows: [{ id: "m1", content: "Auth uses JWT tokens", type: "fact", scope: "global", project_id: null, tags: null }],
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", { name: "get_context", arguments: { query: "auth" } })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Relevant Memories")
    })

    it("should return fallback text when no rules or memories", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", { name: "get_context", arguments: {} })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toBe("No rules or memories found.")
    })
  })

  // --- Tool Execution: get_rules ---

  describe("tools/call: get_rules", () => {
    it("should return formatted rules", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({
        rows: [
          { id: "r1", content: "Use pnpm", type: "rule", scope: "global", project_id: null },
        ],
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", { name: "get_rules", arguments: {} })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Use pnpm")
    })

    it("should return no rules message when empty", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", { name: "get_rules", arguments: {} })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toBe("No rules found.")
    })
  })

  // --- Tool Execution: add_memory ---

  describe("tools/call: add_memory", () => {
    it("should store a memory and return confirmation", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "add_memory",
          arguments: { content: "Use Zod for validation", type: "rule" },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Stored rule (global)")
      expect(body.result.content[0].text).toContain("Use Zod for validation")

      // Verify the SQL was called with correct args
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("INSERT INTO memories"),
        })
      )
    })

    it("should default to note type", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "add_memory",
          arguments: { content: "Some info" },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Stored note")
    })

    it("should handle project-scoped memory", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "add_memory",
          arguments: {
            content: "Use strict mode",
            type: "rule",
            project_id: "github.com/user/repo",
          },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("project:repo")
    })

    it("should handle tags, paths, category, and metadata", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "add_memory",
          arguments: {
            content: "Deploy workflow",
            type: "skill",
            tags: ["deploy", "ci"],
            paths: ["src/api/**"],
            category: "devops",
            metadata: { name: "deploy" },
          },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Stored skill")

      // Verify serialized fields in SQL call
      const callArgs = mockExecute.mock.calls[0][0].args
      expect(callArgs).toContain("deploy,ci")      // tags joined
      expect(callArgs).toContain("src/api/**")      // paths joined
      expect(callArgs).toContain("devops")           // category
      expect(callArgs).toContain('{"name":"deploy"}') // metadata stringified
    })

    it("should fall back to note for invalid type", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "add_memory",
          arguments: { content: "test", type: "invalid" },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Stored note")
    })
  })

  // --- Tool Execution: edit_memory ---

  describe("tools/call: edit_memory", () => {
    it("should update memory content", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "edit_memory",
          arguments: { id: "abc123", content: "Updated content" },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toBe("Updated memory abc123")

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE memories SET"),
        })
      )
    })

    it("should update type with validation", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "edit_memory",
          arguments: { id: "abc123", type: "skill" },
        })
      ))

      const sql = mockExecute.mock.calls[0][0].sql as string
      expect(sql).toContain("type = ?")
    })

    it("should reject invalid type silently", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "edit_memory",
          arguments: { id: "abc123", type: "invalid_type" },
        })
      ))

      const sql = mockExecute.mock.calls[0][0].sql as string
      expect(sql).not.toContain("type = ?")
    })

    it("should error when id is missing", async () => {
      setupAuth()

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "edit_memory",
          arguments: { content: "no id" },
        })
      ))
      const body = await response.json()
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain("id is required")
    })

    it("should include deleted_at IS NULL guard", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "edit_memory",
          arguments: { id: "abc123", content: "test" },
        })
      ))

      const sql = mockExecute.mock.calls[0][0].sql as string
      expect(sql).toContain("deleted_at IS NULL")
    })
  })

  // --- Tool Execution: forget_memory ---

  describe("tools/call: forget_memory", () => {
    it("should soft-delete memory", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "forget_memory",
          arguments: { id: "abc123" },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toBe("Deleted memory abc123")

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("deleted_at"),
        })
      )
    })

    it("should include deleted_at IS NULL guard", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "forget_memory",
          arguments: { id: "abc123" },
        })
      ))

      const sql = mockExecute.mock.calls[0][0].sql as string
      expect(sql).toContain("deleted_at IS NULL")
    })

    it("should error when id is missing", async () => {
      setupAuth()

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "forget_memory",
          arguments: {},
        })
      ))
      const body = await response.json()
      expect(body.error).toBeDefined()
    })
  })

  // --- Tool Execution: search_memories ---

  describe("tools/call: search_memories", () => {
    it("should return formatted search results", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({
        rows: [
          { id: "m1", content: "JWT for authentication", type: "decision", scope: "global", project_id: null, tags: "auth" },
        ],
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "search_memories",
          arguments: { query: "auth" },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Found 1 memories")
      expect(body.result.content[0].text).toContain("[decision]")
      expect(body.result.content[0].text).toContain("JWT for authentication")
    })

    it("should return no results message", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "search_memories",
          arguments: { query: "nonexistent" },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toBe("No memories found.")
    })

    it("should fall back to LIKE when FTS5 fails", async () => {
      setupAuth()
      // First call (FTS5) throws
      mockExecute.mockRejectedValueOnce(new Error("no such table: memories_fts"))
      // Second call (LIKE fallback) succeeds
      mockExecute.mockResolvedValueOnce({
        rows: [
          { id: "m1", content: "Found via LIKE", type: "note", scope: "global", project_id: null, tags: null },
        ],
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "search_memories",
          arguments: { query: "LIKE" },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Found 1 memories")
    })

    it("should pass type filter to search", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({
        rows: [
          { id: "m1", content: "A decision", type: "decision", scope: "global", project_id: null, tags: null },
        ],
      })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "search_memories",
          arguments: { query: "test", type: "decision" },
        })
      ))

      // FTS5 SQL should include type filter
      const sql = mockExecute.mock.calls[0][0].sql as string
      expect(sql).toContain("m.type = ?")
    })
  })

  // --- Tool Execution: list_memories ---

  describe("tools/call: list_memories", () => {
    it("should return formatted memory list", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({
        rows: [
          { id: "m1", content: "A note", type: "note", scope: "global", project_id: null, tags: null },
          { id: "m2", content: "A rule", type: "rule", scope: "global", project_id: null, tags: "important" },
        ],
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "list_memories",
          arguments: {},
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("2 memories")
    })

    it("should filter by type", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "list_memories",
          arguments: { type: "rule" },
        })
      ))

      const sql = mockExecute.mock.calls[0][0].sql as string
      expect(sql).toContain("type = ?")
      expect(mockExecute.mock.calls[0][0].args).toContain("rule")
    })

    it("should filter by tags with LIKE escaping", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "list_memories",
          arguments: { tags: "100%" },
        })
      ))

      const sql = mockExecute.mock.calls[0][0].sql as string
      expect(sql).toContain("ESCAPE")
      // The % in "100%" should be escaped
      const args = mockExecute.mock.calls[0][0].args as string[]
      expect(args.some((a: string) => typeof a === "string" && a.includes("100\\%"))).toBe(true)
    })

    it("should include project scope when project_id provided", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "list_memories",
          arguments: { project_id: "github.com/user/repo" },
        })
      ))

      const sql = mockExecute.mock.calls[0][0].sql as string
      expect(sql).toContain("project_id = ?")
    })

    it("should return no results message", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "list_memories",
          arguments: {},
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toBe("No memories found.")
    })
  })

  // --- Tool Execution: unknown tool ---

  describe("tools/call: unknown tool", () => {
    it("should return error for unknown tool", async () => {
      setupAuth()

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "nonexistent_tool",
          arguments: {},
        })
      ))
      const body = await response.json()
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain("Unknown tool")
    })
  })

  // --- API key extraction ---

  describe("API key from query param", () => {
    it("should accept api_key query parameter", async () => {
      setupAuth()
      const request = new NextRequest("https://example.com/api/mcp?api_key=mcp_testkey123", {
        method: "POST",
        body: JSON.stringify(jsonrpc("ping")),
        headers: { "content-type": "application/json" },
      })
      const response = await POST(request)
      const body = await response.json()
      expect(body.result).toEqual({})
    })
  })
})
