import { describe, expect, it } from "vitest"
import { extractBearerToken, parseRetryAfterSeconds } from "./http-headers"

describe("extractBearerToken", () => {
  it("accepts Authorization bearer scheme in any casing", () => {
    expect(extractBearerToken("bearer mem_test_key")).toBe("mem_test_key")
    expect(extractBearerToken("BEARER mem_test_key")).toBe("mem_test_key")
  })

  it("returns null for invalid or empty bearer headers", () => {
    expect(extractBearerToken(null)).toBeNull()
    expect(extractBearerToken("Basic token")).toBeNull()
    expect(extractBearerToken("Bearer    ")).toBeNull()
  })
})

describe("parseRetryAfterSeconds", () => {
  it("clamps numeric retry-after values to at least one second", () => {
    expect(parseRetryAfterSeconds("0", 60)).toBe(1)
    expect(parseRetryAfterSeconds("-5", 60)).toBe(1)
  })

  it("supports HTTP-date retry-after values", () => {
    const nowMs = Date.UTC(2026, 0, 1, 0, 0, 0)
    const httpDate = new Date(nowMs + 90_000).toUTCString()
    expect(parseRetryAfterSeconds(httpDate, 60, nowMs)).toBe(90)
  })

  it("falls back to configured default for invalid header values", () => {
    expect(parseRetryAfterSeconds("not-a-date", 45, Date.UTC(2026, 0, 1, 0, 0, 0))).toBe(45)
  })
})
