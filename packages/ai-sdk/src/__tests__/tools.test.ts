import { describe, expect, it, vi } from "vitest"
import { memoriesTools } from "../tools"

function createMockClient() {
  return {
    context: {
      get: vi.fn().mockResolvedValue({ rules: [], memories: [], raw: "" }),
    },
    memories: {
      add: vi.fn().mockResolvedValue({ ok: true, message: "stored", raw: "stored" }),
      search: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue([]),
      forget: vi.fn().mockResolvedValue({ ok: true, message: "forgot", raw: "forgot" }),
      edit: vi.fn().mockResolvedValue({ ok: true, message: "edited", raw: "edited" }),
    },
  }
}

describe("memoriesTools", () => {
  it("requires tenantId when a client instance is not provided", () => {
    expect(() => memoriesTools({ apiKey: "mcp_test" })).toThrow("tenantId is required")
  })

  it("forwards full context input through the core client", async () => {
    const client = createMockClient()
    const tools = memoriesTools({
      client: client as unknown as any,
      tenantId: "tenant-a",
      userId: "user-default",
      projectId: "github.com/acme/repo",
    })

    await tools.getContext({
      query: "auth",
      includeRules: false,
      includeSkillFiles: true,
      mode: "working",
      strategy: "hybrid",
      graphDepth: 2,
      graphLimit: 12,
      sessionId: "sess_1",
      budgetTokens: 500,
      turnCount: 6,
      turnBudget: 12,
      lastActivityAt: "2026-02-26T10:00:00.000Z",
      inactivityThresholdMinutes: 45,
      taskCompleted: false,
      includeSessionSummary: true,
    })

    expect(client.context.get).toHaveBeenCalledWith({
      query: "auth",
      includeRules: false,
      includeSkillFiles: true,
      projectId: "github.com/acme/repo",
      userId: "user-default",
      tenantId: "tenant-a",
      mode: "working",
      strategy: "hybrid",
      graphDepth: 2,
      graphLimit: 12,
      sessionId: "sess_1",
      budgetTokens: 500,
      turnCount: 6,
      turnBudget: 12,
      lastActivityAt: "2026-02-26T10:00:00.000Z",
      inactivityThresholdMinutes: 45,
      taskCompleted: false,
      includeSessionSummary: true,
    })
  })

  it("routes tool calls through the core client", async () => {
    const client = createMockClient()
    const tools = memoriesTools({ client: client as unknown as any, projectId: "github.com/acme/repo" })

    await tools.getContext({ query: "auth" })
    await tools.storeMemory({ content: "Use zod" })
    await tools.searchMemories({ query: "zod" })
    await tools.listMemories()
    await tools.forgetMemory({ id: "abc123" })
    await tools.editMemory({ id: "abc123", updates: { content: "Updated" } })

    expect(client.context.get).toHaveBeenCalledWith({
      query: "auth",
      projectId: "github.com/acme/repo",
      userId: undefined,
      tenantId: undefined,
    })
    expect(client.memories.add).toHaveBeenCalledWith({ content: "Use zod", projectId: "github.com/acme/repo" })
    expect(client.memories.search).toHaveBeenCalledWith("zod", { projectId: "github.com/acme/repo" })
    expect(client.memories.list).toHaveBeenCalledWith({ projectId: "github.com/acme/repo" })
    expect(client.memories.forget).toHaveBeenCalledWith("abc123")
    expect(client.memories.edit).toHaveBeenCalledWith("abc123", { content: "Updated" })
  })
})
