import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"
import { isIP } from "node:net"
import { getUpstashRedisConfig, parseBooleanFlag } from "@/lib/env"

interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

interface RateLimiter {
  limit: (identifier: string) => Promise<RateLimitResult>
}

class InMemorySlidingWindowLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; reset: number }>()
  private readonly maxBuckets: number
  private lastCleanupAt = 0

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    maxBuckets = 10_000
  ) {
    this.maxBuckets = Math.max(1_000, maxBuckets)
  }

  private cleanup(now: number): void {
    if (this.buckets.size < this.maxBuckets && now - this.lastCleanupAt < this.windowMs) {
      return
    }

    this.lastCleanupAt = now

    for (const [identifier, bucket] of this.buckets) {
      if (bucket.reset <= now) {
        this.buckets.delete(identifier)
      }
    }

    if (this.buckets.size <= this.maxBuckets) {
      return
    }

    const overflow = this.buckets.size - this.maxBuckets
    const sortedByExpiry = [...this.buckets.entries()].sort((a, b) => a[1].reset - b[1].reset)
    for (let i = 0; i < overflow; i += 1) {
      const entry = sortedByExpiry[i]
      if (!entry) break
      this.buckets.delete(entry[0])
    }
  }

  async limit(identifier: string): Promise<RateLimitResult> {
    const now = Date.now()
    this.cleanup(now)
    const bucket = this.buckets.get(identifier)

    if (!bucket || bucket.reset <= now) {
      const reset = now + this.windowMs
      this.buckets.set(identifier, { count: 1, reset })
      return {
        success: true,
        limit: this.max,
        remaining: Math.max(0, this.max - 1),
        reset,
      }
    }

    bucket.count += 1
    const success = bucket.count <= this.max
    return {
      success,
      limit: this.max,
      remaining: Math.max(0, this.max - bucket.count),
      reset: bucket.reset,
    }
  }
}

function createRateLimiter(max: number, windowSeconds: number, prefix: string): RateLimiter {
  const redisConfig = getUpstashRedisConfig()

  if (redisConfig) {
    const redis = new Redis(redisConfig)
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
      prefix,
    })
  }

  return new InMemorySlidingWindowLimiter(max, windowSeconds * 1000)
}

/**
 * Standard rate limiter for authenticated API routes.
 * 60 requests per 60 seconds per user.
 */
export const apiRateLimit = createRateLimiter(60, 60, "rl:api")

/**
 * Pre-auth rate limiter for authenticated API routes.
 * 120 requests per 60 seconds per IP.
 */
const preAuthApiRateLimit = createRateLimiter(120, 60, "rl:preauth")

/**
 * Strict rate limiter for expensive operations (db provisioning, account deletion).
 * 5 requests per 60 seconds per user.
 */
export const strictRateLimit = createRateLimiter(5, 60, "rl:strict")

/**
 * Rate limiter for public/unauthenticated endpoints (CLI auth polling).
 * 30 requests per 60 seconds per IP.
 */
export const publicRateLimit = createRateLimiter(30, 60, "rl:public")

/**
 * Rate limiter for MCP endpoint (higher limit, long-lived sessions).
 * 120 requests per 60 seconds per API key.
 */
export const mcpRateLimit = createRateLimiter(120, 60, "rl:mcp")

/**
 * Check rate limit and return 429 response if exceeded.
 * Returns null if the request is allowed.
 */
export async function checkRateLimit(
  limiter: RateLimiter,
  identifier: string
): Promise<NextResponse | null> {
  const { success, limit, remaining, reset } = await limiter.limit(identifier)

  if (!success) {
    const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000))

    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": limit.toString(),
          "X-RateLimit-Remaining": remaining.toString(),
          "X-RateLimit-Reset": reset.toString(),
          "Retry-After": retryAfterSeconds.toString(),
        },
      }
    )
  }

  return null
}

/**
 * Check pre-auth per-IP rate limit for authenticated API endpoints.
 * Returns null if the request is allowed.
 */
export async function checkPreAuthApiRateLimit(request: Request): Promise<NextResponse | null> {
  return checkRateLimit(preAuthApiRateLimit, getClientIp(request))
}

/**
 * Extract client IP from request headers for public endpoint rate limiting.
 */
export function getClientIp(request: Request): string {
  const platformHeaders = [
    "x-vercel-ip",
    "cf-connecting-ip",
    "fly-client-ip",
    "fastly-client-ip",
    "x-client-ip",
  ]

  for (const header of platformHeaders) {
    const value = normalizeClientIpCandidate(request.headers.get(header))
    if (value) return value
  }

  const trustProxyHeaders = parseBooleanFlag(process.env.TRUST_PROXY_HEADERS, false)
  if (trustProxyHeaders) {
    const forwardedFor = request.headers.get("x-forwarded-for")
    if (forwardedFor) {
      const primaryForwardedIp = forwardedFor
        .split(",")
        .map((segment) => normalizeClientIpCandidate(segment))
        .find((segment): segment is string => Boolean(segment))
      if (primaryForwardedIp) {
        return primaryForwardedIp
      }
    }

    const realIp = normalizeClientIpCandidate(request.headers.get("x-real-ip"))
    if (realIp) return realIp
  }

  return "unknown"
}

function normalizeClientIpCandidate(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return isIP(trimmed) ? trimmed : null
}
