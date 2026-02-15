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
        const runSingle = () => {
          if (table === "users") {
            return mockAdminSelect({ table, filters })
          }
          if (table === "sdk_tenant_databases") {
            return mockTenantSelect({ table, filters })
          }
          return { data: null, error: { message: `Unexpected table: ${table}` } }
        }
        const query = {
          eq: vi.fn((column: string, value: unknown) => {
            filters[column] = value
            return query
          }),
          single: vi.fn(runSingle),
          maybeSingle: vi.fn(runSingle),
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
const mockBatch = vi.fn()
vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: mockExecute,
    batch: mockBatch,
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

const VALID_API_KEY = `mem_${"a".repeat(64)}`

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
    mockTenantSelect.mockReturnValue({ data: null, error: null })
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
    it("should return 9 tools", async () => {
      setupAuth()
      const response = await POST(makePostRequest(jsonrpc("tools/list")))
      const body = await response.json()
      expect(body.result.tools).toHaveLength(9)

      const toolNames = body.result.tools.map((t: { name: string }) => t.name)
      expect(toolNames).toContain("get_context")
      expect(toolNames).toContain("get_rules")
      expect(toolNames).toContain("add_memory")
      expect(toolNames).toContain("edit_memory")
      expect(toolNames).toContain("forget_memory")
      expect(toolNames).toContain("search_memories")
      expect(toolNames).toContain("list_memories")
      expect(toolNames).toContain("bulk_forget_memories")
      expect(toolNames).toContain("vacuum_memories")
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
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("memory_layer = 'rule'") || sql.includes("type = 'rule'")) {
          return {
            rows: [
              { id: "r1", content: "Use TypeScript strict mode", type: "rule", memory_layer: "rule", scope: "global", project_id: null },
            ],
          }
        }
        return { rows: [] }
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
      expect(mockResolveActiveMemoryContext).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        expect.objectContaining({
          projectId: "github.com/user/repo",
          fallbackToUserWithoutOrgCredentials: true,
        })
      )
    })

    it("should include search results when query provided", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("memory_layer = 'rule'") || sql.includes("type = 'rule'")) {
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

    it("clamps oversized context limits to safe bounds", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "get_context",
          arguments: { query: "auth", limit: 5000 },
        })
      ))

      const workingCall = getExecuteCallBySqlFragment("m.memory_layer = 'working'")
      const longTermCall = getExecuteCallBySqlFragment("m.type != ?")
      expect(workingCall.args?.at(-1)).toBe(3)
      expect(longTermCall.args?.at(-1)).toBe(50)
    })

    it("falls back to default context limit when limit is non-positive", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "get_context",
          arguments: { query: "auth", limit: -1 },
        })
      ))

      const workingCall = getExecuteCallBySqlFragment("m.memory_layer = 'working'")
      const longTermCall = getExecuteCallBySqlFragment("m.type != ?")
      expect(workingCall.args?.at(-1)).toBe(3)
      expect(longTermCall.args?.at(-1)).toBe(5)
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

    it("orders relevant memories as working first, then long-term", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("memory_layer = 'rule'") || sql.includes("type = 'rule'")) {
          return { rows: [] }
        }
        if (sql.includes("memory_layer = 'working'")) {
          return {
            rows: [{ id: "w1", content: "Current task context", type: "note", memory_layer: "working", scope: "global", project_id: null, tags: null }],
          }
        }
        if (sql.includes("memory_layer IS NULL OR m.memory_layer = 'long_term'")) {
          return {
            rows: [{ id: "l1", content: "Durable architecture decision", type: "decision", memory_layer: "long_term", scope: "global", project_id: null, tags: null }],
          }
        }
        return { rows: [] }
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", { name: "get_context", arguments: { query: "architecture" } })
      ))
      const body = await response.json()
      const text = body.result.content[0].text as string
      expect(text.indexOf("Current task context")).toBeLessThan(text.indexOf("Durable architecture decision"))
      expect(body.result.structuredContent.workingMemories).toHaveLength(1)
      expect(body.result.structuredContent.longTermMemories).toHaveLength(1)
    })

    it.each([
      {
        name: "shared scope on default database",
        args: {},
        expectedUserFilter: "user_id IS NULL",
        expectedUserArg: null,
        tenantId: null,
      },
      {
        name: "shared + user scope on tenant database",
        args: { tenant_id: "tenant-a", user_id: "user-42" },
        expectedUserFilter: "user_id IS NULL OR user_id = ?",
        expectedUserArg: "user-42",
        tenantId: "tenant-a",
      },
    ])("e2e matrix: enforces isolation and tier order ($name)", async ({ args, expectedUserFilter, expectedUserArg, tenantId }) => {
      setupAuth()
      if (tenantId) {
        mockTenantSelect.mockReturnValue({
          data: {
            turso_db_url: "libsql://tenant-a.turso.io",
            turso_db_token: "tenant-token",
            status: "ready",
          },
        })
      }

      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("memory_layer = 'rule'") || sql.includes("type = 'rule'")) {
          return {
            rows: [
              { id: "r1", content: "Always validate inputs", type: "rule", memory_layer: "rule", scope: "global", project_id: null, user_id: null, tags: null },
            ],
          }
        }
        if (sql.includes("memory_layer = 'working'")) {
          return {
            rows: [
              { id: "w1", content: "In-flight migration context", type: "note", memory_layer: "working", scope: "global", project_id: null, user_id: expectedUserArg, tags: null },
            ],
          }
        }
        if (sql.includes("memory_layer IS NULL OR memory_layer = 'long_term'")) {
          return {
            rows: [
              { id: "l1", content: "Persisted architecture decision", type: "decision", memory_layer: "long_term", scope: "global", project_id: null, user_id: expectedUserArg, tags: null },
            ],
          }
        }
        return { rows: [] }
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", { name: "get_context", arguments: args })
      ))
      const body = await response.json()
      const text = body.result.content[0].text as string
      expect(text.indexOf("In-flight migration context")).toBeLessThan(text.indexOf("Persisted architecture decision"))
      expect(body.result.structuredContent.memories.map((memory: { id: string }) => memory.id)).toEqual(["w1", "l1"])

      const workingCall = getExecuteCallBySqlFragment("AND memory_layer = 'working'")
      const longTermCall = getExecuteCallBySqlFragment("AND (memory_layer IS NULL OR memory_layer = 'long_term')")
      expect(workingCall.sql).toContain(expectedUserFilter)
      expect(longTermCall.sql).toContain(expectedUserFilter)
      if (expectedUserArg) {
        expect(workingCall.args).toContain(expectedUserArg)
        expect(longTermCall.args).toContain(expectedUserArg)
      }

      if (tenantId) {
        const tenantLookup = mockTenantSelect.mock.calls[0]?.[0] as { filters?: Record<string, string> }
        expect(tenantLookup.filters?.tenant_id).toBe(tenantId)
      }
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

    it("filters expired rules from results", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", { name: "get_rules", arguments: {} })
      ))

      const sql = getLastExecuteCall().sql
      expect(sql).toContain("expires_at IS NULL OR expires_at > ?")
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

    it("defaults non-rule memories to long_term layer", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "add_memory",
          arguments: { content: "A durable note", type: "note" },
        })
      ))

      const insertCall = getExecuteCallBySqlFragment("INSERT INTO memories")
      expect(insertCall.args).toContain("long_term")
    })

    it("accepts explicit working layer", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "add_memory",
          arguments: { content: "In-progress context", layer: "working" },
        })
      ))

      const insertCall = getExecuteCallBySqlFragment("INSERT INTO memories")
      expect(insertCall.args).toContain("working")
    })

    it("applies TTL and compaction policy for working memories", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({})

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "add_memory",
          arguments: { content: "Ephemeral task state", layer: "working" },
        })
      ))

      const insertCall = getExecuteCallBySqlFragment("INSERT INTO memories")
      expect(insertCall.args?.[4]).toEqual(expect.stringMatching(/Z$/))

      const expiryCompactionCall = getExecuteCallBySqlFragment("expires_at IS NOT NULL")
      expect(expiryCompactionCall.sql).toContain("memory_layer = 'working'")

      const capCompactionCall = getExecuteCallBySqlFragment("LIMIT -1 OFFSET")
      expect(capCompactionCall.sql).toContain("memory_layer = 'working'")
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

      const sql = getExecuteCallBySqlFragment("WHERE id = ? AND deleted_at IS NULL").sql
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

      const sql = getExecuteCallBySqlFragment("WHERE id = ? AND deleted_at IS NULL").sql
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

      const sql = getExecuteCallBySqlFragment("WHERE id = ? AND deleted_at IS NULL").sql
      expect(sql).toContain("deleted_at IS NULL")
    })

    it("returns validation error when content is empty", async () => {
      setupAuth()

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "edit_memory",
          arguments: { id: "abc123", content: "   " },
        })
      ))

      const body = await response.json()
      expect(body.error.code).toBe(-32602)
      expect(body.error.data.code).toBe("MEMORY_CONTENT_REQUIRED")
    })

    it("returns not found when edit target does not exist", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rowsAffected: 0 })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "edit_memory",
          arguments: { id: "missing-id", content: "test" },
        })
      ))

      const body = await response.json()
      expect(body.error.code).toBe(-32004)
      expect(body.error.data.code).toBe("MEMORY_NOT_FOUND")
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

      const call = getExecuteCallBySqlFragment("WHERE id = ? AND deleted_at IS NULL")
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

    it("returns not found when delete target does not exist", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rowsAffected: 0 })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "forget_memory",
          arguments: { id: "missing-id" },
        })
      ))

      const body = await response.json()
      expect(body.error.code).toBe(-32004)
      expect(body.error.data.code).toBe("MEMORY_NOT_FOUND")
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
      expect(call.sql).toContain("m.expires_at IS NULL OR m.expires_at > ?")
      expect(call.args).toContain("user-42")
    })

    it("returns typed error when layer is invalid", async () => {
      setupAuth()
      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "search_memories",
          arguments: { query: "auth", layer: "invalid-layer" },
        })
      ))
      const body = await response.json()
      expect(body.error.code).toBe(-32602)
      expect(body.error.data.code).toBe("MEMORY_LAYER_INVALID")
    })

    it("clamps oversized search limits", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "search_memories",
          arguments: { query: "auth", limit: 5000 },
        })
      ))

      const call = getExecuteCallBySqlFragment("FROM memories_fts")
      expect(call.args?.at(-1)).toBe(50)
    })

    it("falls back to default search limit when non-positive", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "search_memories",
          arguments: { query: "auth", limit: -1 },
        })
      ))

      const call = getExecuteCallBySqlFragment("FROM memories_fts")
      expect(call.args?.at(-1)).toBe(10)
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
      expect(sql).toContain("expires_at IS NULL OR expires_at > ?")
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

    it("filters list by memory layer when provided", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "list_memories",
          arguments: { layer: "working" },
        })
      ))

      const sql = getLastExecuteCall().sql
      expect(sql).toContain("memory_layer = 'working'")
    })

    it("clamps oversized list limits", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "list_memories",
          arguments: { limit: 5000 },
        })
      ))

      const call = getLastExecuteCall()
      expect(call.args?.at(-1)).toBe(100)
    })

    it("falls back to default list limit when non-positive", async () => {
      setupAuth()
      mockExecute.mockResolvedValue({ rows: [] })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "list_memories",
          arguments: { limit: -1 },
        })
      ))

      const call = getLastExecuteCall()
      expect(call.args?.at(-1)).toBe(20)
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
      mockTenantSelect.mockReturnValue({ data: null, error: null })

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

  // --- Tool Execution: bulk_forget_memories ---

  describe("tools/call: bulk_forget_memories", () => {
    it("should bulk soft-delete memories matching type filter", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("SELECT id FROM memories")) {
          return { rows: [{ id: "m1" }, { id: "m2" }] }
        }
        return { rows: [] }
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { types: ["note", "fact"] },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Bulk deleted 2 memories")
      expect(body.result.structuredContent.ok).toBe(true)
      expect(body.result.structuredContent.data.count).toBe(2)
      expect(body.result.structuredContent.data.ids).toEqual(["m1", "m2"])
    })

    it("should return dry run preview without deleting", async () => {
      setupAuth()
      mockExecute.mockImplementation(async () => {
        return {
          rows: [
            { id: "m1", type: "note", content: "Short note" },
            { id: "m2", type: "fact", content: "A fact about something longer than eighty characters that should be truncated for preview purposes in the response" },
          ],
        }
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { types: ["note", "fact"], dry_run: true },
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Dry run")
      expect(body.result.structuredContent.data.count).toBe(2)
      expect(body.result.structuredContent.data.memories).toHaveLength(2)
      expect(body.result.structuredContent.data.memories[0].contentPreview).toBe("Short note")
      // Verify truncation at 80 chars
      expect(body.result.structuredContent.data.memories[1].contentPreview).toMatch(/\.\.\.$/u)
      expect(body.result.structuredContent.data.memories[1].contentPreview.length).toBeLessThanOrEqual(84) // 80 trimmed + "..."
    })

    it("should report accurate count when dry run exceeds 1000 preview limit", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (_input: { sql: string } | string) => {
        // Single LIMIT 1001 query returns 1001 rows to signal overflow
        const previewRows = Array.from({ length: 1001 }, (_, i) => ({
          id: `m${i}`, type: "note", content: `Memory ${i}`,
        }))
        return { rows: previewRows }
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { types: ["note"], dry_run: true },
        })
      ))
      const body = await response.json()
      // count is capped at 1000 when overflow detected (no unbounded COUNT)
      expect(body.result.structuredContent.data.count).toBe(1000)
      expect(body.result.structuredContent.data.memories).toHaveLength(1000)
      expect(body.result.content[0].text).toContain("more than 1000")
    })

    it("should build WHERE clause with tags filter using LIKE", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("SELECT id FROM memories")) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { tags: ["temp", "debug"] },
        })
      ))

      const selectCall = getExecuteCallBySqlFragment("SELECT id FROM memories")
      expect(selectCall.sql).toContain("tags LIKE ? ESCAPE")
      // Both tags should produce LIKE args with wildcards
      const likeArgs = (selectCall.args as string[]).filter((a: string) => typeof a === "string" && a.startsWith("%"))
      expect(likeArgs).toHaveLength(2)
      expect(likeArgs[0]).toBe("%temp%")
      expect(likeArgs[1]).toBe("%debug%")
    })

    it("should build WHERE clause with older_than_days filter", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("SELECT id FROM memories")) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { older_than_days: 30 },
        })
      ))

      const selectCall = getExecuteCallBySqlFragment("SELECT id FROM memories")
      expect(selectCall.sql).toContain("created_at < ?")
      // The cutoff arg should be an ISO date string
      const dateArg = (selectCall.args as string[]).find((a: string) => typeof a === "string" && a.includes("T"))
      expect(dateArg).toBeDefined()
      expect(new Date(dateArg!).getTime()).toBeLessThan(Date.now())
    })

    it("should build WHERE clause with pattern filter converting * to %", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("SELECT id FROM memories")) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { pattern: "TODO*" },
        })
      ))

      const selectCall = getExecuteCallBySqlFragment("SELECT id FROM memories")
      expect(selectCall.sql).toContain("content LIKE ? ESCAPE")
      expect(selectCall.args).toContain("%TODO%%")
    })

    it("should build WHERE clause with project_id filter", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("SELECT id FROM memories")) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { types: ["note"], project_id: "github.com/acme/repo" },
        })
      ))

      const selectCall = getExecuteCallBySqlFragment("SELECT id FROM memories")
      expect(selectCall.sql).toContain("project_id = ?")
      expect(selectCall.args).toContain("github.com/acme/repo")
    })

    it("should return zero count when no memories match filters", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("SELECT id FROM memories")) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { types: ["skill"] },
        })
      ))
      const body = await response.json()
      expect(body.result.structuredContent.data.count).toBe(0)
      expect(body.result.structuredContent.data.ids).toEqual([])
      expect(body.result.content[0].text).toContain("No memories matched")
    })

    it("should batch deletes when more than 500 IDs", async () => {
      setupAuth()
      const manyIds = Array.from({ length: 750 }, (_, i) => ({ id: `m${i}` }))
      let updateCallCount = 0
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("SELECT id FROM memories")) {
          return { rows: manyIds }
        }
        if (sql.includes("UPDATE memories SET deleted_at")) {
          updateCallCount++
        }
        return { rows: [] }
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { all: true },
        })
      ))
      const body = await response.json()
      expect(body.result.structuredContent.data.count).toBe(750)
      // 750 IDs at batch size 500 = 2 UPDATE calls
      expect(updateCallCount).toBe(2)
    })

    it("should reject when no filters provided", async () => {
      setupAuth()
      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: {},
        })
      ))
      const body = await response.json()
      expect(body.error.code).toBe(-32602)
      expect(body.error.data.code).toBe("BULK_FORGET_NO_FILTERS")
    })

    it("should reject all:true combined with other filters", async () => {
      setupAuth()
      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { all: true, types: ["note"] },
        })
      ))
      const body = await response.json()
      expect(body.error.code).toBe(-32602)
      expect(body.error.data.code).toBe("BULK_FORGET_INVALID_FILTERS")
    })

    it("should treat empty arrays as no filter", async () => {
      setupAuth()
      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { types: [], tags: [] },
        })
      ))
      const body = await response.json()
      expect(body.error.code).toBe(-32602)
      expect(body.error.data.code).toBe("BULK_FORGET_NO_FILTERS")
    })

    it("should accept all:true alone", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("SELECT id FROM memories")) {
          return { rows: [{ id: "m1" }] }
        }
        return { rows: [] }
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { all: true },
        })
      ))
      const body = await response.json()
      expect(body.result.structuredContent.data.count).toBe(1)
    })

    it("constrains bulk deletes by user_id when provided", async () => {
      setupAuth()
      mockExecute.mockImplementation(async (input: { sql: string } | string) => {
        const sql = typeof input === "string" ? input : input.sql
        if (sql.includes("SELECT id FROM memories")) {
          return { rows: [] }
        }
        return { rows: [] }
      })

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "bulk_forget_memories",
          arguments: { types: ["note"], user_id: "user-42" },
        })
      ))
      const body = await response.json()
      expect(body.result.structuredContent.data.count).toBe(0)

      const selectCall = getExecuteCallBySqlFragment("SELECT id FROM memories")
      expect(selectCall.sql).toContain("user_id = ?")
      expect(selectCall.args).toContain("user-42")
    })
  })

  // --- Tool Execution: vacuum_memories ---

  describe("tools/call: vacuum_memories", () => {
    it("should purge soft-deleted memories", async () => {
      setupAuth()
      mockBatch.mockResolvedValue([
        { rows: [] },
        { rows: [{ cnt: 5 }] },
      ])

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "vacuum_memories",
          arguments: {},
        })
      ))
      const body = await response.json()
      expect(body.result.content[0].text).toContain("Vacuumed 5")
      expect(body.result.structuredContent.ok).toBe(true)
      expect(body.result.structuredContent.data.purged).toBe(5)
    })

    it("should return zero when nothing to vacuum", async () => {
      setupAuth()
      mockBatch.mockResolvedValue([
        { rows: [] },
        { rows: [{ cnt: 0 }] },
      ])

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "vacuum_memories",
          arguments: {},
        })
      ))
      const body = await response.json()
      expect(body.result.structuredContent.data.purged).toBe(0)
      expect(body.result.content[0].text).toContain("No soft-deleted")
    })

    it("constrains vacuum by user_id when provided", async () => {
      setupAuth()
      mockBatch.mockResolvedValue([
        { rows: [] },
        { rows: [{ cnt: 0 }] },
      ])

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "vacuum_memories",
          arguments: { user_id: "user-42" },
        })
      ))

      expect(mockBatch).toHaveBeenCalledTimes(1)
      const stmts = mockBatch.mock.calls[0][0] as { sql: string; args: unknown[] }[]
      const deleteStmt = stmts.find((s) => s.sql.includes("DELETE FROM memories"))
      expect(deleteStmt).toBeDefined()
      expect(deleteStmt!.sql).toContain("user_id = ?")
      expect(deleteStmt!.args).toContain("user-42")
    })

    it("should use batch() for atomic DELETE + changes()", async () => {
      setupAuth()
      mockBatch.mockResolvedValue([
        { rows: [] },
        { rows: [{ cnt: 3 }] },
      ])

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "vacuum_memories",
          arguments: {},
        })
      ))
      const body = await response.json()
      expect(body.result.structuredContent.data.purged).toBe(3)
      // Must use batch(), not separate execute() calls
      expect(mockBatch).toHaveBeenCalledTimes(1)
      const stmts = mockBatch.mock.calls[0][0] as { sql: string; args: unknown[] }[]
      expect(stmts).toHaveLength(2)
      expect(stmts[0].sql).toContain("DELETE FROM memories")
      expect(stmts[1].sql).toContain("changes()")
      // No separate execute calls for vacuum (ensureSchema may use execute, but no vacuum queries)
      const vacuumExecuteCalls = mockExecute.mock.calls.filter(
        (entry: unknown[]) => {
          const s = typeof entry[0] === "string" ? entry[0] : (entry[0] as { sql?: string })?.sql
          return s?.includes("DELETE FROM memories") || s?.includes("changes()")
        }
      )
      expect(vacuumExecuteCalls).toHaveLength(0)
    })

    it("should constrain vacuum to user_id IS NULL when no user_id provided", async () => {
      setupAuth()
      mockBatch.mockResolvedValue([
        { rows: [] },
        { rows: [{ cnt: 0 }] },
      ])

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "vacuum_memories",
          arguments: {},
        })
      ))

      const stmts = mockBatch.mock.calls[0][0] as { sql: string; args: unknown[] }[]
      const deleteStmt = stmts.find((s) => s.sql.includes("DELETE FROM memories"))
      expect(deleteStmt!.sql).toContain("user_id IS NULL")
      expect(deleteStmt!.sql).toContain("deleted_at IS NOT NULL")
    })

    it("should only target soft-deleted rows in DELETE", async () => {
      setupAuth()
      mockBatch.mockResolvedValue([
        { rows: [] },
        { rows: [{ cnt: 2 }] },
      ])

      await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "vacuum_memories",
          arguments: {},
        })
      ))

      const stmts = mockBatch.mock.calls[0][0] as { sql: string; args: unknown[] }[]
      const deleteStmt = stmts.find((s) => s.sql.includes("DELETE FROM memories"))
      expect(deleteStmt!.sql).toContain("deleted_at IS NOT NULL")
    })

    it("should route vacuum through tenant database when tenant_id is provided", async () => {
      setupAuth()
      mockTenantSelect.mockReturnValue({
        data: {
          turso_db_url: "libsql://tenant-x.turso.io",
          turso_db_token: "tenant-token",
          status: "ready",
        },
      })
      mockBatch.mockResolvedValue([
        { rows: [] },
        { rows: [{ cnt: 3 }] },
      ])

      const response = await POST(makePostRequest(
        jsonrpc("tools/call", {
          name: "vacuum_memories",
          arguments: { tenant_id: "tenant-x", user_id: "user-1" },
        })
      ))
      const body = await response.json()
      expect(body.result.structuredContent.data.purged).toBe(3)
      expect(mockTenantSelect).toHaveBeenCalled()
      const tenantLookup = mockTenantSelect.mock.calls[0]?.[0] as {
        filters?: Record<string, string>
      }
      expect(tenantLookup.filters?.tenant_id).toBe("tenant-x")
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
