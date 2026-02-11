import { describe, expect, it, vi } from "vitest"
import { MemoriesClient, MemoriesClientError } from "../client"

describe("MemoriesClient", () => {
  it("throws when api key is missing", () => {
    expect(() => new MemoriesClient({ apiKey: "" })).toThrow(MemoriesClientError)
  })

  it("throws when tenant id is an empty string", () => {
    expect(() => new MemoriesClient({ apiKey: "mcp_test", tenantId: "   " })).toThrow(MemoriesClientError)
  })

  it("calls MCP tools through JSON-RPC", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: {
            content: [{ type: "text", text: "Stored note (global): test" }],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com/api/mcp",
      tenantId: "tenant-123",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await client.memories.add({ content: "test" })
    expect(result.ok).toBe(true)
    expect(result.message).toContain("Stored")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(requestInit).toBeDefined()
    expect(requestInit?.method).toBe("POST")
    expect((requestInit?.headers as Record<string, string>).authorization).toBe("Bearer mcp_test")
    const requestBody = JSON.parse((requestInit?.body as string) ?? "{}") as {
      params?: { arguments?: Record<string, unknown> }
    }
    expect(requestBody.params?.arguments?.tenant_id).toBe("tenant-123")
  })

  it("parses structuredContent into typed context arrays", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: {
            content: [{ type: "text", text: "" }],
            structuredContent: {
              ok: true,
              data: {
                rules: [
                  {
                    id: "rule_1",
                    content: "Keep it simple",
                    type: "rule",
                    layer: "rule",
                    scope: "global",
                    projectId: null,
                    tags: [],
                  },
                ],
                workingMemories: [
                  {
                    id: "mem_working_1",
                    content: "Drafting migration script",
                    type: "note",
                    layer: "working",
                    scope: "global",
                    projectId: null,
                    tags: [],
                  },
                ],
                longTermMemories: [
                  {
                    id: "mem_long_1",
                    content: "API rate limit is 100/min",
                    type: "fact",
                    layer: "long_term",
                    scope: "global",
                    projectId: null,
                    tags: [],
                  },
                ],
              },
              error: null,
              meta: {
                version: "2026-02-10",
                tool: "get_context",
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com/api/mcp",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const context = await client.context.get("auth")
    expect(context.rules).toHaveLength(1)
    expect(context.memories).toHaveLength(2)
    expect(context.rules[0]?.layer).toBe("rule")
    expect(context.memories[0]?.layer).toBe("working")
    expect(context.memories[0]?.type).toBe("note")
    expect(context.memories[1]?.type).toBe("fact")
    expect(context.rules[0]?.content).toBe("Keep it simple")
  })

  it.each([
    {
      name: "uses constructor tenant/user scope and preserves tier order",
      clientOptions: { tenantId: "tenant-a", userId: "user-default" },
      input: { query: "auth", mode: "all" as const },
      expected: {
        tenantId: "tenant-a",
        userId: "user-default",
        projectId: undefined,
        memoryIds: ["mem_working_1", "mem_long_1"],
        ruleCount: 1,
      },
    },
    {
      name: "allows per-call user override and working-only mode",
      clientOptions: { tenantId: "tenant-a", userId: "user-default" },
      input: { query: "auth", userId: "user-override", projectId: "github.com/acme/repo", mode: "working" as const },
      expected: {
        tenantId: "tenant-a",
        userId: "user-override",
        projectId: "github.com/acme/repo",
        memoryIds: ["mem_working_1"],
        ruleCount: 1,
      },
    },
    {
      name: "supports rules-only mode for deterministic instruction-only context",
      clientOptions: { tenantId: "tenant-a" },
      input: { userId: "user-42", mode: "rules_only" as const },
      expected: {
        tenantId: "tenant-a",
        userId: "user-42",
        projectId: undefined,
        memoryIds: [],
        ruleCount: 1,
      },
    },
  ])("context matrix: $name", async ({ clientOptions, input, expected }) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: {
            content: [{ type: "text", text: "" }],
            structuredContent: {
              ok: true,
              data: {
                rules: [
                  {
                    id: "rule_1",
                    content: "Keep it simple",
                    type: "rule",
                    layer: "rule",
                    scope: "global",
                    projectId: null,
                    tags: [],
                  },
                ],
                workingMemories: [
                  {
                    id: "mem_working_1",
                    content: "Current user task context",
                    type: "note",
                    layer: "working",
                    scope: "global",
                    projectId: null,
                    tags: [],
                  },
                ],
                longTermMemories: [
                  {
                    id: "mem_long_1",
                    content: "Durable architecture decision",
                    type: "decision",
                    layer: "long_term",
                    scope: "global",
                    projectId: null,
                    tags: [],
                  },
                ],
              },
              error: null,
              meta: { version: "2026-02-10", tool: "get_context" },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com/api/mcp",
      fetch: fetchMock as unknown as typeof fetch,
      ...clientOptions,
    })

    const context = await client.context.get(input)
    expect(context.rules).toHaveLength(expected.ruleCount)
    expect(context.memories.map((memory) => memory.id)).toEqual(expected.memoryIds)

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const requestBody = JSON.parse((requestInit?.body as string) ?? "{}") as {
      params?: { arguments?: Record<string, unknown> }
    }
    const args = requestBody.params?.arguments ?? {}

    expect(args.tenant_id).toBe(expected.tenantId)
    expect(args.user_id).toBe(expected.userId)
    if (expected.projectId) {
      expect(args.project_id).toBe(expected.projectId)
    } else {
      expect(args).not.toHaveProperty("project_id")
    }
  })

  it("parses structuredContent for memory list/search", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { params?: { name?: string } }
      const toolName = body.params?.name

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: {
            content: [{ type: "text", text: "" }],
            structuredContent: {
              ok: true,
              data: {
                memories:
                  toolName === "search_memories"
                    ? [
                        {
                          id: "m_search",
                          content: "Found memory",
                          type: "fact",
                          scope: "global",
                          projectId: null,
                          tags: [],
                        },
                      ]
                    : [
                        {
                          id: "m_list",
                          content: "Listed memory",
                          type: "note",
                          scope: "global",
                          projectId: null,
                          tags: ["tag1"],
                        },
                      ],
              },
              error: null,
              meta: {
                version: "2026-02-10",
                tool: toolName,
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    })

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com/api/mcp",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const searched = await client.memories.search("found")
    const listed = await client.memories.list()

    expect(searched[0]?.id).toBe("m_search")
    expect(listed[0]?.id).toBe("m_list")
    expect(listed[0]?.tags).toEqual(["tag1"])
  })

  it("maps typed JSON-RPC errors to MemoriesClientError", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          error: {
            code: -32602,
            message: "Memory id is required",
            data: {
              type: "validation_error",
              code: "MEMORY_ID_REQUIRED",
              message: "Memory id is required",
              status: 400,
              retryable: false,
              details: { field: "id" },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com/api/mcp",
      fetch: fetchMock as unknown as typeof fetch,
    })

    await expect(client.memories.forget("")).rejects.toMatchObject({
      name: "MemoriesClientError",
      type: "validation_error",
      errorCode: "MEMORY_ID_REQUIRED",
      code: -32602,
      retryable: false,
    })
  })

  it("maps typed HTTP errors from endpoint envelopes", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          ok: false,
          data: null,
          error: "Missing API key",
          errorDetail: {
            type: "auth_error",
            code: "MISSING_API_KEY",
            message: "Missing API key",
            status: 401,
            retryable: false,
          },
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      )
    )

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com/api/mcp",
      fetch: fetchMock as unknown as typeof fetch,
    })

    await expect(client.context.get("auth")).rejects.toMatchObject({
      name: "MemoriesClientError",
      type: "auth_error",
      errorCode: "MISSING_API_KEY",
      status: 401,
      retryable: false,
    })
  })
})
