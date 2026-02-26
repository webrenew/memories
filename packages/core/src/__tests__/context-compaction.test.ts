import { describe, expect, it, vi } from "vitest"
import { MemoriesClient } from "../client"

function extractRpcArgs(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
  const requestBody = JSON.parse((requestInit?.body as string) ?? "{}") as {
    params?: { arguments?: Record<string, unknown> }
  }
  return requestBody.params?.arguments ?? {}
}

describe("context compaction integration", () => {
  it("forwards session budget args over MCP and attaches computed compaction hints", async () => {
    const fetchMock = vi.fn(async () =>
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
                    content: "Always write tests before refactors.",
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
                    content: "Draft migration checklist and rollback plan.",
                    type: "note",
                    layer: "working",
                    scope: "global",
                    projectId: null,
                    tags: ["migration"],
                  },
                ],
                longTermMemories: [],
                memories: [],
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

    const context = await client.context.get({
      query: "migration",
      sessionId: "sess_123",
      budgetTokens: 10,
      turnCount: 15,
      turnBudget: 12,
      lastActivityAt: "2026-02-25T23:00:00.000Z",
      inactivityThresholdMinutes: 30,
      taskCompleted: false,
    })

    expect(context.session).toBeDefined()
    expect(context.session?.sessionId).toBe("sess_123")
    expect(context.session?.compactionRequired).toBe(true)
    expect(context.session?.triggerHint).toBe("count")

    const rpcArgs = extractRpcArgs(fetchMock)
    expect(rpcArgs.session_id).toBe("sess_123")
    expect(rpcArgs.budget_tokens).toBe(10)
    expect(rpcArgs.last_activity_at).toBe("2026-02-25T23:00:00.000Z")
    expect(rpcArgs.inactivity_threshold_minutes).toBe(30)
    expect(rpcArgs.task_completed).toBe(false)
  })

  it("preserves server-provided session state from SDK envelopes", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            rules: [],
            memories: [],
            workingMemories: [],
            longTermMemories: [],
            session: {
              sessionId: "sess_sdk",
              estimatedTokens: 120,
              budgetTokens: 500,
              turnCount: 6,
              turnBudget: 20,
              compactionRequired: false,
              triggerHint: null,
              reason: "No compaction trigger.",
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

    const context = await client.context.get({ query: "release notes" })
    expect(context.session).toEqual({
      sessionId: "sess_sdk",
      estimatedTokens: 120,
      budgetTokens: 500,
      turnCount: 6,
      turnBudget: 20,
      compactionRequired: false,
      triggerHint: null,
      reason: "No compaction trigger.",
    })
  })
})
