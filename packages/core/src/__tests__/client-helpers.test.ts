import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeContextStrategy, resetLegacyStrategyWarningsForTest } from "../client-helpers"

const originalSuppressFlag = process.env.MEMORIES_SUPPRESS_DEPRECATION_WARNINGS

describe("client helper legacy strategy warnings", () => {
  beforeEach(() => {
    delete process.env.MEMORIES_SUPPRESS_DEPRECATION_WARNINGS
    resetLegacyStrategyWarningsForTest()
  })

  afterEach(() => {
    if (originalSuppressFlag === undefined) {
      delete process.env.MEMORIES_SUPPRESS_DEPRECATION_WARNINGS
    } else {
      process.env.MEMORIES_SUPPRESS_DEPRECATION_WARNINGS = originalSuppressFlag
    }
    vi.restoreAllMocks()
  })

  it("warns once when baseline alias is used", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    expect(normalizeContextStrategy("baseline")).toBe("lexical")
    expect(normalizeContextStrategy("baseline")).toBe("lexical")

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[memories] retrieval strategy "baseline" is deprecated. Use "lexical" instead.'
    )
  })

  it("warns once when hybrid_graph alias is used", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    expect(normalizeContextStrategy("hybrid_graph")).toBe("hybrid")
    expect(normalizeContextStrategy("hybrid_graph")).toBe("hybrid")

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[memories] retrieval strategy "hybrid_graph" is deprecated. Use "hybrid" instead.'
    )
  })

  it("supports suppressing legacy warnings via env", () => {
    process.env.MEMORIES_SUPPRESS_DEPRECATION_WARNINGS = "true"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    expect(normalizeContextStrategy("baseline")).toBe("lexical")
    expect(normalizeContextStrategy("hybrid_graph")).toBe("hybrid")

    expect(warnSpy).not.toHaveBeenCalled()
  })
})
