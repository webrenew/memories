import { afterEach, describe, expect, it, vi } from "vitest"

const originalFlags = {
  GRAPH_MAPPING_ENABLED: process.env.GRAPH_MAPPING_ENABLED,
  GRAPH_RETRIEVAL_ENABLED: process.env.GRAPH_RETRIEVAL_ENABLED,
  GRAPH_LLM_EXTRACTION_ENABLED: process.env.GRAPH_LLM_EXTRACTION_ENABLED,
  GRAPH_ROLLOUT_AUTOPILOT_ENABLED: process.env.GRAPH_ROLLOUT_AUTOPILOT_ENABLED,
  GRAPH_DEFAULT_STRATEGY_AUTOPILOT_ENABLED: process.env.GRAPH_DEFAULT_STRATEGY_AUTOPILOT_ENABLED,
}

function restoreGraphFlags(): void {
  for (const [key, value] of Object.entries(originalFlags)) {
    if (value === undefined) {
      delete process.env[key]
      continue
    }
    process.env[key] = value
  }
}

async function loadTypesModule() {
  vi.resetModules()
  return import("./types")
}

afterEach(() => {
  restoreGraphFlags()
  vi.resetModules()
})

describe("graph feature flags", () => {
  it("defaults graph retrieval to true with other graph flags disabled", async () => {
    delete process.env.GRAPH_MAPPING_ENABLED
    delete process.env.GRAPH_RETRIEVAL_ENABLED
    delete process.env.GRAPH_LLM_EXTRACTION_ENABLED
    delete process.env.GRAPH_ROLLOUT_AUTOPILOT_ENABLED
    delete process.env.GRAPH_DEFAULT_STRATEGY_AUTOPILOT_ENABLED

    const mod = await loadTypesModule()
    expect(mod.GRAPH_MAPPING_ENABLED).toBe(false)
    expect(mod.GRAPH_RETRIEVAL_ENABLED).toBe(true)
    expect(mod.GRAPH_LLM_EXTRACTION_ENABLED).toBe(false)
    expect(mod.GRAPH_ROLLOUT_AUTOPILOT_ENABLED).toBe(false)
    expect(mod.GRAPH_DEFAULT_STRATEGY_AUTOPILOT_ENABLED).toBe(true)
  })

  it("parses enabled values for graph flags", async () => {
    process.env.GRAPH_MAPPING_ENABLED = "true"
    process.env.GRAPH_RETRIEVAL_ENABLED = "1"
    process.env.GRAPH_LLM_EXTRACTION_ENABLED = "yes"
    process.env.GRAPH_ROLLOUT_AUTOPILOT_ENABLED = "on"
    process.env.GRAPH_DEFAULT_STRATEGY_AUTOPILOT_ENABLED = "on"

    const mod = await loadTypesModule()
    expect(mod.GRAPH_MAPPING_ENABLED).toBe(true)
    expect(mod.GRAPH_RETRIEVAL_ENABLED).toBe(true)
    expect(mod.GRAPH_LLM_EXTRACTION_ENABLED).toBe(true)
    expect(mod.GRAPH_ROLLOUT_AUTOPILOT_ENABLED).toBe(true)
    expect(mod.GRAPH_DEFAULT_STRATEGY_AUTOPILOT_ENABLED).toBe(true)
  })

  it("falls back to false for invalid flag values", async () => {
    process.env.GRAPH_MAPPING_ENABLED = "maybe"
    process.env.GRAPH_RETRIEVAL_ENABLED = "enabled"
    process.env.GRAPH_LLM_EXTRACTION_ENABLED = "nah"
    process.env.GRAPH_ROLLOUT_AUTOPILOT_ENABLED = "enabled"
    process.env.GRAPH_DEFAULT_STRATEGY_AUTOPILOT_ENABLED = "enabled"

    const mod = await loadTypesModule()
    expect(mod.GRAPH_MAPPING_ENABLED).toBe(false)
    expect(mod.GRAPH_RETRIEVAL_ENABLED).toBe(true)
    expect(mod.GRAPH_LLM_EXTRACTION_ENABLED).toBe(false)
    expect(mod.GRAPH_ROLLOUT_AUTOPILOT_ENABLED).toBe(false)
    expect(mod.GRAPH_DEFAULT_STRATEGY_AUTOPILOT_ENABLED).toBe(true)
  })
})
