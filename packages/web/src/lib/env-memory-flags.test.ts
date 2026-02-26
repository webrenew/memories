import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  isMemoryCompactionEnabled,
  isMemoryConsolidationEnabled,
  isMemoryOpenClawFileModeEnabled,
  isMemoryProceduralEnabled,
  isMemorySessionEnabled,
} from "./env"

const originalValues = {
  session: process.env.MEMORY_SESSION_ENABLED,
  compaction: process.env.MEMORY_COMPACTION_ENABLED,
  consolidation: process.env.MEMORY_CONSOLIDATION_ENABLED,
  procedural: process.env.MEMORY_PROCEDURAL_ENABLED,
  openclaw: process.env.MEMORY_OPENCLAW_FILE_MODE_ENABLED,
}

function restoreEnv(): void {
  if (originalValues.session === undefined) delete process.env.MEMORY_SESSION_ENABLED
  else process.env.MEMORY_SESSION_ENABLED = originalValues.session

  if (originalValues.compaction === undefined) delete process.env.MEMORY_COMPACTION_ENABLED
  else process.env.MEMORY_COMPACTION_ENABLED = originalValues.compaction

  if (originalValues.consolidation === undefined) delete process.env.MEMORY_CONSOLIDATION_ENABLED
  else process.env.MEMORY_CONSOLIDATION_ENABLED = originalValues.consolidation

  if (originalValues.procedural === undefined) delete process.env.MEMORY_PROCEDURAL_ENABLED
  else process.env.MEMORY_PROCEDURAL_ENABLED = originalValues.procedural

  if (originalValues.openclaw === undefined) delete process.env.MEMORY_OPENCLAW_FILE_MODE_ENABLED
  else process.env.MEMORY_OPENCLAW_FILE_MODE_ENABLED = originalValues.openclaw
}

describe("memory lifecycle feature flags", () => {
  beforeEach(() => {
    delete process.env.MEMORY_SESSION_ENABLED
    delete process.env.MEMORY_COMPACTION_ENABLED
    delete process.env.MEMORY_CONSOLIDATION_ENABLED
    delete process.env.MEMORY_PROCEDURAL_ENABLED
    delete process.env.MEMORY_OPENCLAW_FILE_MODE_ENABLED
  })

  afterEach(() => {
    restoreEnv()
  })

  it("uses default-on flags for session, compaction, consolidation, and procedural features", () => {
    expect(isMemorySessionEnabled()).toBe(true)
    expect(isMemoryCompactionEnabled()).toBe(true)
    expect(isMemoryConsolidationEnabled()).toBe(true)
    expect(isMemoryProceduralEnabled()).toBe(true)
    expect(isMemoryOpenClawFileModeEnabled()).toBe(false)
  })

  it("supports explicit opt-out toggles", () => {
    process.env.MEMORY_SESSION_ENABLED = "false"
    process.env.MEMORY_COMPACTION_ENABLED = "0"
    process.env.MEMORY_CONSOLIDATION_ENABLED = "off"
    process.env.MEMORY_PROCEDURAL_ENABLED = "no"
    process.env.MEMORY_OPENCLAW_FILE_MODE_ENABLED = "1"

    expect(isMemorySessionEnabled()).toBe(false)
    expect(isMemoryCompactionEnabled()).toBe(false)
    expect(isMemoryConsolidationEnabled()).toBe(false)
    expect(isMemoryProceduralEnabled()).toBe(false)
    expect(isMemoryOpenClawFileModeEnabled()).toBe(true)
  })
})
