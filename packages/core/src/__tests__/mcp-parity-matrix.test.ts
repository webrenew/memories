import { describe, expect, it, vi } from "vitest"
import { MemoriesClient } from "../client"

function buildMcpToolResponse(toolName: string, data: Record<string, unknown>, text = ""): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      result: {
        content: [{ type: "text", text }],
        structuredContent: {
          ok: true,
          data,
          error: null,
          meta: {
            version: "2026-02-26",
            tool: toolName,
          },
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  )
}

function extractRpcCall(fetchMock: ReturnType<typeof vi.fn>, index = 0): { tool: string; args: Record<string, unknown> } {
  const requestInit = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined
  const body = JSON.parse((requestInit?.body as string) ?? "{}") as {
    params?: { name?: string; arguments?: Record<string, unknown> }
  }
  return {
    tool: String(body.params?.name ?? ""),
    args: body.params?.arguments ?? {},
  }
}

describe("MCP parity matrix", () => {
  it.each([
    { mode: "all" as const, expectedMemoryIds: ["mem_working", "mem_long"] },
    { mode: "working" as const, expectedMemoryIds: ["mem_working"] },
    { mode: "long_term" as const, expectedMemoryIds: ["mem_long"] },
    { mode: "rules_only" as const, expectedMemoryIds: [] },
  ])("forwards context mode=$mode and preserves mode-specific memory shape", async ({ mode, expectedMemoryIds }) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      buildMcpToolResponse("get_context", {
        rules: [
          {
            id: "rule_1",
            content: "Always write tests",
            type: "rule",
            layer: "rule",
            scope: "global",
            projectId: null,
            tags: [],
          },
        ],
        workingMemories: [
          {
            id: "mem_working",
            content: "Current release checklist draft",
            type: "note",
            layer: "working",
            scope: "global",
            projectId: null,
            tags: [],
          },
        ],
        longTermMemories: [
          {
            id: "mem_long",
            content: "Release process runbook",
            type: "fact",
            layer: "long_term",
            scope: "global",
            projectId: null,
            tags: [],
          },
        ],
      })
    )

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com/api/mcp",
      fetch: fetchMock as unknown as typeof fetch,
    })

    const context = await client.context.get({
      query: "release",
      mode,
    })

    expect(context.rules).toHaveLength(1)
    expect(context.memories.map((memory) => memory.id)).toEqual(expectedMemoryIds)

    const rpc = extractRpcCall(fetchMock)
    expect(rpc.tool).toBe("get_context")
    expect(rpc.args.mode).toBe(mode)
  })

  it("forwards layer-aware inputs for add/search/list over MCP", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        params?: { name?: string }
      }
      const tool = String(body.params?.name ?? "")

      if (tool === "add_memory") {
        return buildMcpToolResponse("add_memory", { message: "Stored memory" }, "Stored memory")
      }
      if (tool === "search_memories") {
        return buildMcpToolResponse("search_memories", { memories: [] }, "Found 0 memories")
      }
      if (tool === "list_memories") {
        return buildMcpToolResponse("list_memories", { memories: [] }, "0 memories")
      }

      return buildMcpToolResponse(tool, {})
    })

    const client = new MemoriesClient({
      apiKey: "mcp_test",
      baseUrl: "https://example.com/api/mcp",
      fetch: fetchMock as unknown as typeof fetch,
    })

    await client.memories.add({
      content: "working note",
      type: "note",
      layer: "working",
      projectId: "github.com/acme/platform",
    })

    await client.memories.search("deploy", {
      type: "fact",
      layer: "working",
      limit: 7,
      projectId: "github.com/acme/platform",
    })

    await client.memories.list({
      type: "note",
      layer: "long_term",
      tags: "api,testing",
      limit: 11,
      projectId: "github.com/acme/platform",
    })

    const addRpc = extractRpcCall(fetchMock, 0)
    expect(addRpc.tool).toBe("add_memory")
    expect(addRpc.args.type).toBe("note")
    expect(addRpc.args.layer).toBe("working")
    expect(addRpc.args.project_id).toBe("github.com/acme/platform")

    const searchRpc = extractRpcCall(fetchMock, 1)
    expect(searchRpc.tool).toBe("search_memories")
    expect(searchRpc.args.type).toBe("fact")
    expect(searchRpc.args.layer).toBe("working")
    expect(searchRpc.args.limit).toBe(7)

    const listRpc = extractRpcCall(fetchMock, 2)
    expect(listRpc.tool).toBe("list_memories")
    expect(listRpc.args.type).toBe("note")
    expect(listRpc.args.layer).toBe("long_term")
    expect(listRpc.args.tags).toBe("api,testing")
    expect(listRpc.args.limit).toBe(11)
  })
})
