import { vi } from "vitest"

// Mock environment variables for all tests
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key"
process.env.UPSTASH_REDIS_REST_URL = "https://test.upstash.io"
process.env.UPSTASH_REDIS_REST_TOKEN = "test-redis-token"
process.env.STRIPE_SECRET_KEY = "sk_test_fake"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake"
process.env.STRIPE_PRO_PRICE_ID = "price_pro_monthly"
process.env.STRIPE_PRO_PRICE_ID_ANNUAL = "price_pro_annual"

// Mock @upstash/redis globally — must be before rate-limit imports
// Use a real function (not arrow) so it works as a constructor with `new`
vi.mock("@upstash/redis", () => {
  function Redis() {
    return {}
  }
  return { Redis }
})

// Mock @upstash/ratelimit globally
// Use a real function so it works as a constructor with `new`
vi.mock("@upstash/ratelimit", () => {
  const mockLimit = vi.fn().mockResolvedValue({
    success: true,
    limit: 60,
    remaining: 59,
    reset: Date.now() + 60000,
  })

  function Ratelimit() {
    return { limit: mockLimit }
  }
  Ratelimit.slidingWindow = vi.fn().mockReturnValue("sliding-window")

  return { Ratelimit }
})
