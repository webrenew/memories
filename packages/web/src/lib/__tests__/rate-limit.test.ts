import { describe, it, expect, vi, beforeEach } from "vitest"
import { checkRateLimit, getClientIp } from "../rate-limit"
import { Ratelimit } from "@upstash/ratelimit"

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return null when request is allowed", async () => {
    const limiter = new Ratelimit({
      redis: {} as never,
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      prefix: "test",
    })
    vi.mocked(limiter.limit).mockResolvedValue({
      success: true,
      limit: 60,
      remaining: 59,
      reset: Date.now() + 60000,
      pending: Promise.resolve(),
      reason: "timeout",
    })

    const result = await checkRateLimit(limiter, "user-1")
    expect(result).toBeNull()
  })

  it("should return 429 response when rate limited", async () => {
    const limiter = new Ratelimit({
      redis: {} as never,
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      prefix: "test",
    })
    vi.mocked(limiter.limit).mockResolvedValue({
      success: false,
      limit: 60,
      remaining: 0,
      reset: Date.now() + 30000,
      pending: Promise.resolve(),
      reason: "timeout",
    })

    const result = await checkRateLimit(limiter, "user-1")
    expect(result).not.toBeNull()
    expect(result!.status).toBe(429)

    const body = await result!.json()
    expect(body.error).toBe("Too many requests")
  })

  it("should include rate limit headers on 429", async () => {
    const resetTime = Date.now() + 30000
    const limiter = new Ratelimit({
      redis: {} as never,
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      prefix: "test",
    })
    vi.mocked(limiter.limit).mockResolvedValue({
      success: false,
      limit: 60,
      remaining: 0,
      reset: resetTime,
      pending: Promise.resolve(),
      reason: "timeout",
    })

    const result = await checkRateLimit(limiter, "user-1")
    expect(result!.headers.get("X-RateLimit-Limit")).toBe("60")
    expect(result!.headers.get("X-RateLimit-Remaining")).toBe("0")
    expect(result!.headers.get("X-RateLimit-Reset")).toBe(resetTime.toString())
    expect(result!.headers.get("Retry-After")).toBeDefined()
  })

  it("should clamp Retry-After to at least one second", async () => {
    const limiter = new Ratelimit({
      redis: {} as never,
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      prefix: "test",
    })
    vi.mocked(limiter.limit).mockResolvedValue({
      success: false,
      limit: 60,
      remaining: 0,
      reset: Date.now() - 1000,
      pending: Promise.resolve(),
      reason: "timeout",
    })

    const result = await checkRateLimit(limiter, "user-1")
    expect(result!.headers.get("Retry-After")).toBe("1")
  })
})

describe("getClientIp", () => {
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS

  beforeEach(() => {
    if (originalTrustProxyHeaders === undefined) {
      delete process.env.TRUST_PROXY_HEADERS
    } else {
      process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders
    }
  })

  it("should prefer trusted platform headers", () => {
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    })
    expect(getClientIp(request)).toBe("1.2.3.4")
  })

  it("should return unknown for spoofable proxy headers when trust flag is disabled", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" },
    })
    expect(getClientIp(request)).toBe("unknown")
  })

  it("should extract IP from x-forwarded-for when trust flag is enabled", () => {
    process.env.TRUST_PROXY_HEADERS = "true"
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" },
    })
    expect(getClientIp(request)).toBe("1.2.3.4")
  })

  it("should fall back to x-real-ip when trust flag is enabled", () => {
    process.env.TRUST_PROXY_HEADERS = "1"
    const request = new Request("https://example.com", {
      headers: { "x-real-ip": "10.0.0.1" },
    })
    expect(getClientIp(request)).toBe("10.0.0.1")
  })

  it("should return 'unknown' when no IP headers present", () => {
    const request = new Request("https://example.com")
    expect(getClientIp(request)).toBe("unknown")
  })

  it("should ignore invalid x-forwarded-for values and fall back to x-real-ip", () => {
    process.env.TRUST_PROXY_HEADERS = "true"
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "not-an-ip,   ",
        "x-real-ip": "10.0.0.1",
      },
    })
    expect(getClientIp(request)).toBe("10.0.0.1")
  })

  it("should return unknown when x-real-ip is empty", () => {
    const request = new Request("https://example.com", {
      headers: { "x-real-ip": "   " },
    })
    expect(getClientIp(request)).toBe("unknown")
  })

  it("should ignore malformed client IP header values", () => {
    process.env.TRUST_PROXY_HEADERS = "true"
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "bad-input",
        "x-real-ip": "also-bad",
      },
    })
    expect(getClientIp(request)).toBe("unknown")
  })
})
