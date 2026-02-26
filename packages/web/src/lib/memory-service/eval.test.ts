import { describe, expect, it } from "vitest"
import { runReplayEval } from "./eval"

describe("runReplayEval", () => {
  it("scores extraction, compaction, and trigger quality for replay scenarios", () => {
    const result = runReplayEval({
      nowIso: "2026-02-26T00:00:00.000Z",
      scenarios: [
        {
          id: "scenario-1",
          title: "happy path",
          extraction: {
            expected: ["Prefer short pull requests", "Tag release notes"],
            observed: ["Prefer short pull requests", "Tag release notes", "Tag release notes"],
          },
          compaction: {
            checkpoint:
              "Compaction checkpoint. Prefer short pull requests and tag release notes before shipping.",
            requiredFacts: ["Prefer short pull requests", "Tag release notes"],
          },
          trigger: {
            expected: "count",
            signals: {
              estimatedTokens: 1500,
              budgetTokens: 400,
            },
          },
        },
      ],
    })

    expect(result.summary.status).toBe("pass")
    expect(result.summary.passRate).toBe(1)
    expect(result.summary.extractionF1Avg).toBe(1)
    expect(result.summary.compactionRetentionAvg).toBe(1)
    expect(result.summary.triggerAccuracy).toBe(1)
    expect(result.scenarios[0]?.status).toBe("pass")
  })

  it("returns warn when only part of the replay set passes", () => {
    const result = runReplayEval({
      scenarios: [
        {
          id: "pass-case",
          extraction: {
            expected: ["Use canary rollout"],
            observed: ["Use canary rollout"],
          },
          trigger: {
            expected: "semantic",
            observed: "semantic",
          },
        },
        {
          id: "fail-case",
          extraction: {
            expected: ["Always snapshot before reset"],
            observed: ["Different fact"],
          },
          compaction: {
            checkpoint: "Checkpoint without required data",
            requiredFacts: ["Always snapshot before reset"],
          },
          trigger: {
            expected: "time",
            observed: "count",
          },
        },
      ],
    })

    expect(result.summary.status).toBe("warn")
    expect(result.summary.passRate).toBe(0.5)
    expect(result.scenarios[0]?.status).toBe("pass")
    expect(result.scenarios[1]?.status).toBe("fail")
    expect(result.scenarios[1]?.compaction?.missingFacts).toEqual(["Always snapshot before reset"])
  })

  it("returns fail when the replay set is empty", () => {
    const result = runReplayEval({
      scenarios: [],
    })

    expect(result.summary.status).toBe("fail")
    expect(result.summary.scenarios).toBe(0)
  })
})
