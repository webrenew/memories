import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Supabase admin
const { mockAdminSelect, mockTenantSelect, mockResolveActiveMemoryContext } = vi.hoisted(() => ({
  mockAdminSelect: vi.fn(),
  mockTenantSelect: vi.fn(),
  mockResolveActiveMemoryContext: vi.fn(),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        const filters: Record<string, unknown> = {}
        const query = {
          eq: vi.fn((column: string, value: unknown) => {
            filters[column] = value
            return query
          }),
          single: vi.fn(() => {
            if (table === "users") {
              return mockAdminSelect({ table, filters })
            }
            if (table === "sdk_tenant_databases") {
              return mockTenantSelect({ table, filters })
            }
            return { data: null, error: { message: `Unexpected table: ${table}` } }
          }),
        }
        return query
      }),
    })),
  })),
}))

vi.mock("@/lib/active-memory-context", () => ({
  resolveActiveMemoryContext: mockResolveActiveMemoryContext,
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
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}))

import { GET, POST, OPTIONS } from "../route"
import { NextRequest } from "next/server"

const VALID_API_KEY = `mcp_${"a".repeat(64)}`

// Helpers
function makePostRequest(body: unknown, apiKey = VALID_API_KEY): NextRequest {
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
      mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
    },
  })
  mockResolveActiveMemoryContext.mockResolvedValue({
    ownerType: "user",
    orgId: null,
    turso_db_url: "libsql://test.turso.io",
    turso_db_token: "token",
    turso_db_name: "test",
  })
}

function getLastExecuteCall(): { sql: string; args?: unknown[] } {
  const call = mockExecute.mock.calls.at(-1)?.[0] as { sql: string; args?: unknown[] } | undefined
  if (!call) {
    throw new Error("Expected Turso execute to be called")
  }
  return call
}

function getExecuteCallBySqlFragment(fragment: string): { sql: string; args?: unknown[] } {
  const call = mockExecute.mock.calls.find((entry) => {
    const sql = entry[0]?.sql
    return typeof sql === "string" && sql.includes(fragment)
  })?.[0] as { sql: string; args?: unknown[] } | undefined

  if (!call) {
    throw new Error(`Expected Turso execute call containing SQL fragment: ${fragment}`)
  }
  return call
}

describe("/api/mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTenantSelect.mockReturnValue({ data: null, error: { message: "not found" } })
    mockResolveActiveMemoryContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      turso_db_url: "libsql://test.turso.io",
      turso_db_token: "token",
      turso_db_name: "test",
    })
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
        data: { id: "user-1", email: "test@example.com", mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z" },
      })
      mockResolveActiveMemoryContext.mockResolvedValue({
        ownerType: "user",
        orgId: null,
        turso_db_url: null,
        turso_db_token: null,
        turso_db_name: null,
      })
      const response = await GET(makeGetRequest(VALID_API_KEY))
      expect(response.status).toBe(400)
    })

    it("should return 401 for expired API key", async () => {
      mockAdminSelect.mockReturnValue({
        data: { id: "user-1", email: "test@example.com", mcp_api_key_expires_at: "2020-01-01T00:00:00.000Z" },
      })
      const response = await GET(makeGetRequest(VALID_API_KEY))
      expect(response.status).toBe(401)
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
      const body = await response.json()
      expect(body.error).toBe("Missing API key")
      expect(body.errorDetail.code).toBe("MISSING_API_KEY")
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
      expect(body.error.data.code).toBe("METHOD_NOT_FOUND")
      expect(body.error.data.type).toBe("method_error")
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
      expect(body.result.structuredContent.ok).toBe(true)
      expect(body.result.structuredContent.data.rules).toHaveLength(1)
      expect(body.result.structuredContent.rules).toHaveLength(1)
      expect(body.result.structuredContent.memories).toHaveLength(0)
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
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("WHERE type = 'rule'")) {
          return {
            rows: [{ id: "r1", content: "Always use strict mode", type: "rule", scope: "global", project_id: null }],
          }
        }
        if (sql.includes("FROM memories_fts")) {
          return {
            rows: [{ id: "m1", content: "Auth uses JWT tokens", type: "fact", scope: "global", project_id: null, tags: null }],
          }
        }
        return { rows: [] }
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
      const callArgs = getExecuteCallBySqlFragment("INSERT INTO memories").args as unknown[]
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

    it("stores user_id when provided", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "add_memory",
          arguments: { content: "User preference", user_id: "user-42" },
        })
      ))

      const insertCall = getExecuteCallBySqlFragment("INSERT INTO memories")
      expect(insertCall.args).toContain("user-42")
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

      const sql = getExecuteCallBySqlFragment("UPDATE memories SET").sql
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

      const sql = getExecuteCallBySqlFragment("UPDATE memories SET").sql
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
      expect(body.error.code).toBe(-32602)
      expect(body.error.data.code).toBe("MEMORY_ID_REQUIRED")
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

      const sql = getExecuteCallBySqlFragment("UPDATE memories SET").sql
      expect(sql).toContain("deleted_at IS NULL")
    })

    it("constrains edits by user_id when provided", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "edit_memory",
          arguments: { id: "abc123", content: "test", user_id: "user-42" },
        })
      ))

      const call = getExecuteCallBySqlFragment("UPDATE memories SET")
      expect(call.sql).toContain("AND user_id = ?")
      expect(call.args).toContain("user-42")
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

      const sql = getExecuteCallBySqlFragment("UPDATE memories SET deleted_at").sql
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
      expect(body.error.code).toBe(-32602)
      expect(body.error.data.code).toBe("MEMORY_ID_REQUIRED")
    })

    it("constrains deletes by user_id when provided", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "forget_memory",
          arguments: { id: "abc123", user_id: "user-42" },
        })
      ))

      const call = getExecuteCallBySqlFragment("UPDATE memories SET deleted_at")
      expect(call.sql).toContain("AND user_id = ?")
      expect(call.args).toContain("user-42")
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
      expect(body.result.structuredContent.ok).toBe(true)
      expect(body.result.structuredContent.data.count).toBe(1)
      expect(body.result.structuredContent.memories).toHaveLength(1)
      expect(body.result.structuredContent.memories[0].content).toBe("JWT for authentication")
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
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("FROM memories_fts")) {
          throw new Error("no such table: memories_fts")
        }
        if (sql.includes("content LIKE ?")) {
          return {
            rows: [
              { id: "m1", content: "Found via LIKE", type: "note", scope: "global", project_id: null, tags: null },
            ],
          }
        }
        return { rows: [] }
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
      const sql = getExecuteCallBySqlFragment("FROM memories_fts").sql
      expect(sql).toContain("m.type = ?")
    })

    it("applies user scope filter when user_id is provided", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "search_memories",
          arguments: { query: "auth", user_id: "user-42" },
        })
      ))

      const call = getExecuteCallBySqlFragment("FROM memories_fts")
      expect(call.sql).toContain("m.user_id IS NULL OR m.user_id = ?")
      expect(call.args).toContain("user-42")
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
      expect(body.result.structuredContent.ok).toBe(true)
      expect(body.result.structuredContent.data.count).toBe(2)
      expect(body.result.structuredContent.memories).toHaveLength(2)
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

      const sql = getLastExecuteCall().sql
      expect(sql).toContain("type = ?")
      expect(getLastExecuteCall().args).toContain("rule")
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

      const sql = getLastExecuteCall().sql
      expect(sql).toContain("ESCAPE")
      // The % in "100%" should be escaped
      const args = getLastExecuteCall().args as string[]
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

      const sql = getLastExecuteCall().sql
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

    it("defaults to shared memories only when user_id is absent", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "list_memories",
          arguments: {},
        })
      ))

      const sql = getLastExecuteCall().sql
      expect(sql).toContain("user_id IS NULL")
    })

    it("includes shared + user memories when user_id is provided", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "list_memories",
          arguments: { user_id: "user-42" },
        })
      ))

      const call = getLastExecuteCall()
      expect(call.sql).toContain("user_id IS NULL OR user_id = ?")
      expect(call.args).toContain("user-42")
    })
  })

  describe("tools/call: tenant routing", () => {
    it("routes tool execution through tenant-specific Turso credentials when tenant_id is provided", async () => {
      setupAuth()
      mockTenantSelect.mockReturnValue({
        data: {
          turso_db_url: "libsql://tenant-a.turso.io",
          turso_db_token: "tenant-token",
          status: "ready",
        },
      })
      mockExecute.mockResolvedValue({ rows: [] })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "get_rules",
          arguments: { tenant_id: "tenant-a" },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toBe("No rules found.")
      expect(mockTenantSelect).toHaveBeenCalled()

      const tenantLookup = mockTenantSelect.mock.calls[0]?.[0] as {
        filters?: Record<string, string>
      }
      expect(tenantLookup.filters?.tenant_id).toBe("tenant-a")
      expect(tenantLookup.filters?.api_key_hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it("returns typed error when tenant_id is invalid", async () => {
      setupAuth()
      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "get_rules",
          arguments: { tenant_id: 42 },
        })
      ))
      const body = await response.json()
      expect(body.error.code).toBe(-32602)
      expect(body.error.data.code).toBe("TENANT_ID_INVALID")
    })

    it("returns typed error when user_id is invalid", async () => {
      setupAuth()
      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "get_rules",
          arguments: { user_id: 42 },
        })
      ))
      const body = await response.json()
      expect(body.error.code).toBe(-32602)
      expect(body.error.data.code).toBe("USER_ID_INVALID")
    })

    it("returns typed error when tenant database is not configured", async () => {
      setupAuth()
      mockTenantSelect.mockReturnValue({ data: null, error: { message: "not found" } })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "get_rules",
          arguments: { tenant_id: "tenant-missing" },
        })
      ))
      const body = await response.json()
      expect(body.error.code).toBe(-32004)
      expect(body.error.data.code).toBe("TENANT_DATABASE_NOT_CONFIGURED")
    })

    it("returns typed error when tenant database is not ready", async () => {
      setupAuth()
      mockTenantSelect.mockReturnValue({
        data: {
          turso_db_url: "libsql://tenant-b.turso.io",
          turso_db_token: "tenant-token",
          status: "provisioning",
        },
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "get_rules",
          arguments: { tenant_id: "tenant-b" },
        })
      ))
      const body = await response.json()
      expect(body.error.code).toBe(-32009)
      expect(body.error.data.code).toBe("TENANT_DATABASE_NOT_READY")
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
      expect(body.error.code).toBe(-32601)
      expect(body.error.data.code).toBe("TOOL_NOT_FOUND")
      expect(body.error.message).toContain("Unknown tool")
    })
  })

  // --- API key extraction ---

  describe("API key from query param", () => {
    it("should reject api_key query parameter without bearer auth", async () => {
      const request = new NextRequest("https://example.com/api/mcp?api_key=mcp_testkey123", {
        method: "POST",
        body: JSON.stringify(jsonrpc("ping")),
        headers: { "content-type": "application/json" },
      })
      const response = await POST(request)
      expect(response.status).toBe(401)
    })
  })
})
