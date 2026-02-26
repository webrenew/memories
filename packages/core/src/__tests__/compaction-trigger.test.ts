import { describe, expect, it } from "vitest"
import { estimateContextTokens, evaluateCompactionTrigger, hasCompactionSignals } from "../compaction"

const RULE = {
  id: "rule_1",
  content: "Always keep tests deterministic and isolated.",
  type: "rule" as const,
  layer: "rule" as const,
  scope: "global" as const,
  projectId: null,
  tags: [],
}

const MEMORY = {
  id: "mem_1",
  content: "The background worker retries failed jobs up to 3 times.",
  type: "fact" as const,
  layer: "long_term" as const,
  scope: "project" as const,
  projectId: "github.com/acme/platform",
  tags: ["jobs", "retries"],
}

describe("compaction trigger engine", () => {
  it("estimates token usage from rules, memories, and skill files", () => {
    const withoutSkills = estimateContextTokens({
      rules: [RULE],
      memories: [MEMORY],
      skillFiles: [],
    })

    const withSkills = estimateContextTokens({
      rules: [RULE],
      memories: [MEMORY],
      skillFiles: [
        {
          id: "skill_1",
          path: "skills/release/SKILL.md",
          content: "Run checks, deploy canary, verify logs, then promote.",
          scope: "project",
          projectId: "github.com/acme/platform",
          userId: "user-1",
          createdAt: "2026-02-26T00:00:00.000Z",
          updatedAt: "2026-02-26T00:00:00.000Z",
        },
      ],
    })

    expect(withoutSkills).toBeGreaterThan(0)
    expect(withSkills).toBeGreaterThan(withoutSkills)
  })

  it("fires count trigger when estimated tokens exceed budget", () => {
    const result = evaluateCompactionTrigger({
      sessionId: "sess_1",
      rules: [RULE],
      memories: [MEMORY],
      budgetTokens: 10,
    })

    expect(result.compactionRequired).toBe(true)
    expect(result.triggerHint).toBe("count")
    expect(result.reason).toContain("exceed budget")
  })

  it("fires count trigger when turn count exceeds turn budget", () => {
    const result = evaluateCompactionTrigger({
      sessionId: "sess_1",
      rules: [RULE],
      memories: [MEMORY],
      turnCount: 24,
      turnBudget: 20,
    })

    expect(result.compactionRequired).toBe(true)
    expect(result.triggerHint).toBe("count")
    expect(result.reason).toContain("Turn count")
  })

  it("fires time trigger when inactivity threshold is exceeded", () => {
    const result = evaluateCompactionTrigger({
      sessionId: "sess_2",
      rules: [RULE],
      memories: [MEMORY],
      lastActivityAt: "2026-02-25T00:00:00.000Z",
      inactivityThresholdMinutes: 30,
      now: "2026-02-25T01:00:00.000Z",
    })

    expect(result.compactionRequired).toBe(true)
    expect(result.triggerHint).toBe("time")
  })

  it("fires semantic trigger when task completion is signaled", () => {
    const result = evaluateCompactionTrigger({
      sessionId: "sess_3",
      rules: [RULE],
      memories: [MEMORY],
      taskCompleted: true,
    })

    expect(result.compactionRequired).toBe(true)
    expect(result.triggerHint).toBe("semantic")
  })

  it("reports no trigger when no thresholds are exceeded", () => {
    const result = evaluateCompactionTrigger({
      sessionId: "sess_4",
      rules: [RULE],
      memories: [MEMORY],
      budgetTokens: 10_000,
      turnCount: 2,
      turnBudget: 20,
      taskCompleted: false,
    })

    expect(result.compactionRequired).toBe(false)
    expect(result.triggerHint).toBeNull()
  })

  it("detects when compaction signal inputs are present", () => {
    expect(hasCompactionSignals({})).toBe(false)
    expect(hasCompactionSignals({ budgetTokens: 1000 })).toBe(true)
    expect(hasCompactionSignals({ sessionId: "sess_x" })).toBe(true)
  })
})
