import { authenticateRequest } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { apiRateLimit, checkPreAuthApiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { buildIntegrationHealthPayload } from "@/lib/integration-health"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const preAuthRateLimited = await checkPreAuthApiRateLimit(request)
  if (preAuthRateLimited) return preAuthRateLimited

  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  try {
    const admin = createAdminClient()
    const health = await buildIntegrationHealthPayload({
      admin,
      userId: auth.userId,
      email: auth.email,
    })

    return NextResponse.json(
      { health },
      {
        headers: {
          "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
        },
      }
    )
  } catch (error) {
    console.error("Failed to build integration health payload:", error)
    return NextResponse.json({ error: "Failed to load integration health" }, { status: 500 })
  }
}
