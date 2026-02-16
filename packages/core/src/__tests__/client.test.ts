import { describe, expect, it, vi } from "vitest"
import { MemoriesClient, MemoriesClientError } from "../client"

describe("MemoriesClient", () => {
  it("throws when api key is missing", () => {
    expect(() => new MemoriesClient({ apiKey: "" })).toThrow(MemoriesClientError)
  })

  it("throws when tenant id is an empty string", () => {
    expect(() => new MemoriesClient({ apiKey: "mcp_test", tenantId: "   " })).toThrow(MemoriesClientError)
  })

  it("uses SDK HTTP endpoints by default", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            id: "mem_1",
            message: "Stored note",
            memory: {
              id: "mem_1",
              content: "test",
              type: "note",
              layer: "long_term",
              scope: "global",
              projectId: null,
              tags: [],
            },
          },
          error: null,
          meta: { version: "2026-02-11" },
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    )

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com",
      tenantId: "tenant-123",
      userId: "user-abc",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await client.memories.add({ content: "test" })
    expect(result.ok).toBe(true)
    expect(result.message).toBe("Stored note")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://example.com/api/sdk/v1/memories/add")
    expect(init.method).toBe("POST")
    const parsedBody = JSON.parse((init.body as string) ?? "{}") as {
      scope?: { tenantId?: string; userId?: string }
    }
    expect(parsedBody.scope?.tenantId).toBe("tenant-123")
    expect(parsedBody.scope?.userId).toBe("user-abc")
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

  it("forwards hybrid graph options to MCP get_context args", async () => {
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
                rules: [],
                workingMemories: [],
                longTermMemories: [],
                memories: [],
                trace: {
                  strategy: "hybrid_graph",
                  graphDepth: 2,
                  graphLimit: 12,
                  baselineCandidates: 0,
                  graphCandidates: 0,
                  graphExpandedCount: 0,
                  totalCandidates: 0,
                },
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
    })

    const result = await client.context.get({
      query: "auth",
      strategy: "hybrid_graph",
      graphDepth: 2,
      graphLimit: 12,
    })
    expect(result.trace?.strategy).toBe("hybrid_graph")

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const requestBody = JSON.parse((requestInit?.body as string) ?? "{}") as {
      params?: { arguments?: Record<string, unknown> }
    }
    const args = requestBody.params?.arguments ?? {}
    expect(args.retrieval_strategy).toBe("hybrid_graph")
    expect(args.graph_depth).toBe(2)
    expect(args.graph_limit).toBe(12)
  })

  it("forwards hybrid graph options to SDK context endpoint body", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            rules: [],
            memories: [],
            workingMemories: [],
            longTermMemories: [],
            trace: {
              strategy: "hybrid_graph",
              graphDepth: 1,
              graphLimit: 8,
              baselineCandidates: 0,
              graphCandidates: 0,
              graphExpandedCount: 0,
              totalCandidates: 0,
            },
          },
          error: null,
          meta: { version: "2026-02-11" },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com",
      fetch: fetchMock as unknown as typeof fetch,
    })

    await client.context.get({
      query: "auth",
      strategy: "hybrid_graph",
      graphDepth: 1,
      graphLimit: 8,
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://example.com/api/sdk/v1/context/get")
    const parsedBody = JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>
    expect(parsedBody.strategy).toBe("hybrid_graph")
    expect(parsedBody.graphDepth).toBe(1)
    expect(parsedBody.graphLimit).toBe(8)
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

  it("supports typed management key and tenant operations over sdk_http", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"

      if (url === "https://example.com/api/sdk/v1/management/keys" && method === "GET") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              hasKey: true,
              keyPreview: "mcp_abcd****1234",
              createdAt: "2026-02-11T00:00:00.000Z",
              expiresAt: "2026-03-11T00:00:00.000Z",
              isExpired: false,
            },
            error: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }

      if (url === "https://example.com/api/sdk/v1/management/keys" && method === "POST") {
        const body = JSON.parse((init?.body as string) ?? "{}") as { expiresAt?: string }
        expect(body.expiresAt).toBe("2026-12-31T00:00:00.000Z")

        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              apiKey: "mcp_new_key",
              keyPreview: "mcp_new****key",
              message: "Save this key - it won't be shown again",
            },
            error: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }

      if (url === "https://example.com/api/sdk/v1/management/keys" && method === "DELETE") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { ok: true },
            error: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }

      if (url === "https://example.com/api/sdk/v1/management/tenant-overrides" && method === "GET") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              tenantDatabases: [
                {
                  tenantId: "tenant-a",
                  tursoDbUrl: "libsql://tenant-a.turso.io",
                  tursoDbName: "tenant-a",
                  status: "ready",
                  source: "override",
                  metadata: { environment: "prod" },
                },
              ],
              count: 1,
            },
            error: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }

      if (url === "https://example.com/api/sdk/v1/management/tenant-overrides" && method === "POST") {
        const body = JSON.parse((init?.body as string) ?? "{}") as { tenantId?: string; mode?: string }
        expect(body.tenantId).toBe("tenant-b")
        expect(body.mode).toBe("provision")

        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              tenantDatabase: {
                tenantId: "tenant-b",
                tursoDbUrl: "libsql://tenant-b.turso.io",
                tursoDbName: "tenant-b",
                status: "ready",
                source: "override",
                metadata: {},
              },
              provisioned: true,
              mode: "provision",
            },
            error: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }

      if (url === "https://example.com/api/sdk/v1/management/tenant-overrides?tenantId=tenant-b" && method === "DELETE") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              ok: true,
              tenantId: "tenant-b",
              status: "disabled",
              updatedAt: "2026-02-11T00:00:00.000Z",
            },
            error: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }

      return new Response("not found", { status: 404 })
    })

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const keyStatus = await client.management.keys.get()
    const createdKey = await client.management.keys.create({ expiresAt: "2026-12-31T00:00:00.000Z" })
    const revokedKey = await client.management.keys.revoke()
    const tenantList = await client.management.tenants.list()
    const tenantUpsert = await client.management.tenants.upsert({ tenantId: "tenant-b", mode: "provision" })
    const tenantDisabled = await client.management.tenants.disable("tenant-b")

    expect(keyStatus.hasKey).toBe(true)
    expect(createdKey.apiKey).toBe("mcp_new_key")
    expect(revokedKey.ok).toBe(true)
    expect(tenantList.count).toBe(1)
    expect(tenantUpsert.tenantDatabase.tenantId).toBe("tenant-b")
    expect(tenantDisabled.status).toBe("disabled")
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it("validates management inputs before making a request", async () => {
    const fetchMock = vi.fn()
    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com",
      fetch: fetchMock as unknown as typeof fetch,
    })

    await expect(client.management.keys.create({ expiresAt: "   " })).rejects.toMatchObject({
      name: "MemoriesClientError",
      type: "validation_error",
      errorCode: "INVALID_MANAGEMENT_INPUT",
    })

    await expect(client.management.tenants.disable("   ")).rejects.toMatchObject({
      name: "MemoriesClientError",
      type: "validation_error",
      errorCode: "INVALID_MANAGEMENT_INPUT",
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
