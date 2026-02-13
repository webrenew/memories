import { describe, expect, it } from "vitest"
import type { Memory } from "@/types/memory"
import { buildMemoryInsights } from "./memory-insights"

function buildMemory(
  id: string,
  overrides: Partial<Memory> = {},
): Memory {
  const now = "2026-02-13T12:00:00.000Z"
  return {
    id,
    content: "Default memory content",
    tags: null,
    type: "note",
    scope: "global",
    project_id: null,
    paths: null,
    category: null,
    metadata: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

describe("buildMemoryInsights", () => {
  const now = new Date("2026-02-13T12:00:00.000Z")

  it("identifies stale rules and archive actions", () => {
    const memories = [
      buildMemory("rule-old", {
        type: "rule",
        content: "Always require ADR updates when changing API behavior.",
        tags: "api,adr",
        updated_at: "2025-10-01T12:00:00.000Z",
        created_at: "2025-10-01T12:00:00.000Z",
      }),
      buildMemory("rule-fresh", {
        type: "rule",
        content: "Always tag rollout changes with release metadata.",
        tags: "release",
        updated_at: "2026-02-10T12:00:00.000Z",
        created_at: "2026-02-10T12:00:00.000Z",
      }),
    ]

    const insights = buildMemoryInsights(memories, { now })

    expect(insights.staleRules.count).toBe(1)
    expect(insights.staleRules.items[0]?.id).toBe("rule-old")
    expect(insights.actions.archive.length).toBeGreaterThan(0)
    expect(insights.actions.archive[0]?.memoryIds).toEqual(["rule-old"])
  })

  it("detects conflicting rules in the same project", () => {
    const memories = [
      buildMemory("r1", {
        type: "rule",
        scope: "project",
        project_id: "github.com/WebRenew/memories",
        tags: "auth,mfa",
        content: "Always require MFA for production deploy approvals.",
        created_at: "2026-02-10T12:00:00.000Z",
        updated_at: "2026-02-10T12:00:00.000Z",
      }),
      buildMemory("r2", {
        type: "rule",
        scope: "project",
        project_id: "github.com/WebRenew/memories",
        tags: "auth,mfa",
        content: "Do not require MFA for production deploy approvals.",
        created_at: "2026-02-11T12:00:00.000Z",
        updated_at: "2026-02-11T12:00:00.000Z",
      }),
      buildMemory("r3", {
        type: "rule",
        scope: "project",
        project_id: "github.com/WebRenew/memories",
        tags: "billing",
        content: "Enable billing alerts for usage spikes.",
      }),
    ]

    const insights = buildMemoryInsights(memories, { now })

    expect(insights.conflicts.count).toBeGreaterThan(0)
    expect(insights.conflicts.items[0]?.memoryA.id).toBe("r1")
    expect(insights.conflicts.items[0]?.memoryB.id).toBe("r2")
    expect(insights.conflicts.items[0]?.sharedTags).toContain("mfa")
    expect(
      insights.actions.archive.some(
        (action) =>
          action.memoryIds.includes("r1") ||
          action.memoryIds.includes("r2"),
      ),
    ).toBe(true)
  })

  it("builds weekly summary and suggests relabel + merge actions", () => {
    const memories = [
      buildMemory("n1", {
        type: "note",
        scope: "project",
        project_id: "github.com/WebRenew/memories",
        content: "Dashboard card should show fallback and latency for faster debugging.",
        tags: null,
        created_at: "2026-02-12T12:00:00.000Z",
        updated_at: "2026-02-12T12:00:00.000Z",
      }),
      buildMemory("n2", {
        type: "note",
        scope: "project",
        project_id: "github.com/WebRenew/memories",
        content: "Workspace switch latency budget should be tracked in CI.",
        tags: "perf,workspace",
        created_at: "2026-02-12T13:00:00.000Z",
        updated_at: "2026-02-12T13:00:00.000Z",
      }),
      buildMemory("n3", {
        type: "note",
        scope: "project",
        project_id: "github.com/WebRenew/memories",
        content: "Workspace switch latency budget should be tracked in CI for alerts.",
        tags: "perf,workspace",
        created_at: "2026-02-12T14:00:00.000Z",
        updated_at: "2026-02-12T14:00:00.000Z",
      }),
      buildMemory("old-previous-window", {
        type: "note",
        content: "Legacy memory from previous window.",
        created_at: "2026-02-01T12:00:00.000Z",
        updated_at: "2026-02-01T12:00:00.000Z",
      }),
    ]

    const insights = buildMemoryInsights(memories, { now })

    expect(insights.weekly.changedCount).toBe(3)
    expect(insights.weekly.newCount).toBe(3)
    expect(insights.weekly.trend).toBe("up")
    expect(insights.weekly.topProjects[0]?.project).toBe("github.com/WebRenew/memories")

    expect(insights.actions.relabel.some((action) => action.memoryIds.includes("n1"))).toBe(true)
    expect(insights.actions.merge.some((action) => action.memoryIds.includes("n2"))).toBe(true)
    expect(insights.actions.merge.some((action) => action.memoryIds.includes("n3"))).toBe(true)
  })
})
