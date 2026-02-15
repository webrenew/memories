import { describe, it, expect } from "vitest"
import {
  workingMemoryExpiresAt,
  parseTenantId,
  parseUserId,
  parseMemoryLayer,
  buildLayerFilterClause,
  buildNotExpiredFilter,
  buildUserScopeFilter,
} from "./scope-parsers"

describe("workingMemoryExpiresAt", () => {
  it("returns ISO string in the future", () => {
    const now = new Date().toISOString()
    const result = workingMemoryExpiresAt(now)
    expect(new Date(result).getTime()).toBeGreaterThan(new Date(now).getTime())
  })
})

describe("parseTenantId", () => {
  it("returns null for undefined/empty", () => {
    expect(parseTenantId({})).toBeNull()
    expect(parseTenantId({ tenant_id: null })).toBeNull()
    expect(parseTenantId({ tenant_id: undefined })).toBeNull()
  })

  it("trims and returns valid tenant ID", () => {
    expect(parseTenantId({ tenant_id: "  my-tenant  " })).toBe("my-tenant")
  })

  it("throws for empty string", () => {
    expect(() => parseTenantId({ tenant_id: "" })).toThrow()
    expect(() => parseTenantId({ tenant_id: "   " })).toThrow()
  })
})

describe("parseUserId", () => {
  it("returns null for undefined/empty", () => {
    expect(parseUserId({})).toBeNull()
    expect(parseUserId({ user_id: null })).toBeNull()
  })

  it("returns trimmed user ID", () => {
    expect(parseUserId({ user_id: "  user123  " })).toBe("user123")
  })

  it("throws for empty string", () => {
    expect(() => parseUserId({ user_id: "" })).toThrow()
  })
})

describe("parseMemoryLayer", () => {
  it("returns valid layer names", () => {
    expect(parseMemoryLayer({ layer: "rule" })).toBe("rule")
    expect(parseMemoryLayer({ layer: "working" })).toBe("working")
    expect(parseMemoryLayer({ layer: "long_term" })).toBe("long_term")
  })

  it("returns null for undefined/null", () => {
    expect(parseMemoryLayer({})).toBeNull()
    expect(parseMemoryLayer({ layer: null })).toBeNull()
  })

  it("throws for invalid layer", () => {
    expect(() => parseMemoryLayer({ layer: "invalid" })).toThrow()
  })

  it("throws for non-string layer", () => {
    expect(() => parseMemoryLayer({ layer: 42 })).toThrow()
  })
})

describe("buildLayerFilterClause", () => {
  it("returns 1=1 for null layer", () => {
    expect(buildLayerFilterClause(null).clause).toBe("1 = 1")
  })

  it("generates correct SQL for rule layer", () => {
    const result = buildLayerFilterClause("rule")
    expect(result.clause).toContain("memory_layer = 'rule'")
    expect(result.clause).toContain("type = 'rule'")
  })

  it("generates correct SQL for working layer", () => {
    expect(buildLayerFilterClause("working").clause).toBe("memory_layer = 'working'")
  })

  it("generates correct SQL for long_term layer", () => {
    const result = buildLayerFilterClause("long_term")
    expect(result.clause).toContain("long_term")
  })
})

describe("buildNotExpiredFilter", () => {
  it("returns SQL with datetime comparison", () => {
    const now = new Date().toISOString()
    const result = buildNotExpiredFilter(now)
    expect(result.clause).toContain("expires_at")
    expect(result.args).toEqual([now])
  })
})

describe("buildUserScopeFilter", () => {
  it("returns null-check clause for null userId", () => {
    const result = buildUserScopeFilter(null)
    expect(result.clause).toContain("IS NULL")
    expect(result.args).toEqual([])
  })

  it("returns OR clause for valid userId", () => {
    const result = buildUserScopeFilter("user123")
    expect(result.clause).toContain("IS NULL")
    expect(result.clause).toContain("= ?")
    expect(result.args).toEqual(["user123"])
  })
})
