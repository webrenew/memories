import { afterEach, describe, expect, it, vi } from "vitest"

const originalFlags = {
  GRAPH_MAPPING_ENABLED: process.env.GRAPH_MAPPING_ENABLED,
  GRAPH_RETRIEVAL_ENABLED: process.env.GRAPH_RETRIEVAL_ENABLED,
  GRAPH_LLM_EXTRACTION_ENABLED: process.env.GRAPH_LLM_EXTRACTION_ENABLED,
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
  it("defaults all graph flags to false", async () => {
    delete process.env.GRAPH_MAPPING_ENABLED
    delete process.env.GRAPH_RETRIEVAL_ENABLED
    delete process.env.GRAPH_LLM_EXTRACTION_ENABLED

    const mod = await loadTypesModule()
    expect(mod.GRAPH_MAPPING_ENABLED).toBe(false)
    expect(mod.GRAPH_RETRIEVAL_ENABLED).toBe(false)
    expect(mod.GRAPH_LLM_EXTRACTION_ENABLED).toBe(false)
  })

  it("parses enabled values for graph flags", async () => {
    process.env.GRAPH_MAPPING_ENABLED = "true"
    process.env.GRAPH_RETRIEVAL_ENABLED = "1"
    process.env.GRAPH_LLM_EXTRACTION_ENABLED = "yes"

    const mod = await loadTypesModule()
    expect(mod.GRAPH_MAPPING_ENABLED).toBe(true)
    expect(mod.GRAPH_RETRIEVAL_ENABLED).toBe(true)
    expect(mod.GRAPH_LLM_EXTRACTION_ENABLED).toBe(true)
  })

  it("falls back to false for invalid flag values", async () => {
    process.env.GRAPH_MAPPING_ENABLED = "maybe"
    process.env.GRAPH_RETRIEVAL_ENABLED = "enabled"
    process.env.GRAPH_LLM_EXTRACTION_ENABLED = "nah"

    const mod = await loadTypesModule()
    expect(mod.GRAPH_MAPPING_ENABLED).toBe(false)
    expect(mod.GRAPH_RETRIEVAL_ENABLED).toBe(false)
    expect(mod.GRAPH_LLM_EXTRACTION_ENABLED).toBe(false)
  })
})
