import { describe, expect, it, vi } from "vitest"
import { preloadContext } from "../preload"

describe("preloadContext", () => {
  it("routes preload requests through the core client with inherited scope and lifecycle hints", async () => {
    const client = {
      context: {
        get: vi.fn().mockResolvedValue({ rules: [], memories: [], raw: "" }),
      },
    }

    const context = await preloadContext({
      client: client as unknown as any,
      tenantId: "tenant-a",
      userId: "user-a",
      projectId: "github.com/acme/platform",
      query: "billing architecture",
      limit: 6,
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

    expect(context.raw).toBe("")
    expect(client.context.get).toHaveBeenCalledWith({
      query: "billing architecture",
      limit: 6,
      includeRules: false,
      includeSkillFiles: true,
      projectId: "github.com/acme/platform",
      userId: "user-a",
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
})
