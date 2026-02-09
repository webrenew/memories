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
})

describe("getClientIp", () => {
  it("should extract IP from x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    })
    expect(getClientIp(request)).toBe("1.2.3.4")
  })

  it("should trim whitespace from x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" },
    })
    expect(getClientIp(request)).toBe("1.2.3.4")
  })

  it("should fall back to x-real-ip", () => {
    const request = new Request("https://example.com", {
      headers: { "x-real-ip": "10.0.0.1" },
    })
    expect(getClientIp(request)).toBe("10.0.0.1")
  })

  it("should return 'unknown' when no IP headers present", () => {
    const request = new Request("https://example.com")
    expect(getClientIp(request)).toBe("unknown")
  })

  it("should prefer x-forwarded-for over x-real-ip", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "10.0.0.1",
      },
    })
    expect(getClientIp(request)).toBe("1.2.3.4")
  })
})
