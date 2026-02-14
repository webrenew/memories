import { describe, it, expect } from "vitest"
import {
  formatLastLogin,
  formatAuditAction,
  summarizeAuditMetadata,
  parseListField,
  sameStringList,
  formatListField,
} from "./team-helpers"

describe("formatLastLogin", () => {
  it("returns 'Never' for null", () => {
    expect(formatLastLogin(null)).toBe("Never")
  })

  it("returns a formatted string for valid date", () => {
    const result = formatLastLogin("2025-01-15T10:30:00.000Z")
    expect(result).toBeTruthy()
    expect(result).not.toBe("Never")
    expect(result).not.toBe("Unknown")
  })

  it("returns 'Unknown' for invalid date", () => {
    expect(formatLastLogin("not-a-date")).toBe("Unknown")
  })
})

describe("formatAuditAction", () => {
  it("formats known actions", () => {
    expect(formatAuditAction("member_invited")).toBe("Member Invited")
  })

  it("handles single word actions", () => {
    expect(formatAuditAction("created")).toBe("Created")
  })
})

describe("summarizeAuditMetadata", () => {
  it("returns null for null/empty", () => {
    expect(summarizeAuditMetadata(null)).toBeNull()
    expect(summarizeAuditMetadata({})).toBeNull()
  })

  it("formats role changes", () => {
    const result = summarizeAuditMetadata({ role: "admin", previousRole: "member" })
    expect(result).toContain("role=admin")
    expect(result).toContain("previousRole=member")
  })

  it("ignores unknown keys", () => {
    const result = summarizeAuditMetadata({ unknownKey: "value" })
    expect(result).toBeNull()
  })
})

describe("parseListField", () => {
  it("splits on newlines", () => {
    expect(parseListField("a\nb\nc")).toEqual(["a", "b", "c"])
  })

  it("filters empty lines and trims", () => {
    expect(parseListField("  a  \n\n  b  \n")).toEqual(["a", "b"])
  })

  it("splits on commas", () => {
    expect(parseListField("a,b,c")).toEqual(["a", "b", "c"])
  })

  it("deduplicates entries", () => {
    expect(parseListField("a\na\nb")).toEqual(["a", "b"])
  })
})

describe("formatListField", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(formatListField(null)).toBe("")
    expect(formatListField(undefined)).toBe("")
    expect(formatListField([])).toBe("")
  })

  it("joins values with newlines", () => {
    expect(formatListField(["a", "b"])).toBe("a\nb")
  })
})

describe("sameStringList", () => {
  it("returns true for equal lists", () => {
    expect(sameStringList(["a", "b"], ["b", "a"])).toBe(true)
  })

  it("returns false for different lists", () => {
    expect(sameStringList(["a"], ["b"])).toBe(false)
  })

  it("returns false for different lengths", () => {
    expect(sameStringList(["a"], ["a", "b"])).toBe(false)
  })
})
