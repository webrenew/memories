import { authenticateRequest } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createTurso } from "@libsql/client"
import { NextResponse } from "next/server"
import { apiRateLimit, checkPreAuthApiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { resolveWorkspaceContext } from "@/lib/workspace"

const FREE_LIMIT = 5000

export async function GET(request: Request) {
  const preAuthRateLimited = await checkPreAuthApiRateLimit(request)
  if (preAuthRateLimited) return preAuthRateLimited

  const auth = await authenticateRequest(request)

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  const workspace = await resolveWorkspaceContext(admin, auth.userId)
  if (!workspace) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const plan = workspace.plan
  const isPro = plan === "pro"

  if (!workspace.hasDatabase || !workspace.turso_db_url || !workspace.turso_db_token) {
    return NextResponse.json({
      plan,
      memoryLimit: isPro ? null : FREE_LIMIT,
      memoryCount: 0,
    })
  }

  let memoryCount = 0
  try {
    const turso = createTurso({
      url: workspace.turso_db_url,
      authToken: workspace.turso_db_token,
    })
    const result = await turso.execute(
      "SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL"
    )
    memoryCount = Number(result.rows[0]?.count ?? 0)
  } catch {
    // If we can't connect, return 0
  }

  return NextResponse.json({
    plan,
    memoryLimit: isPro ? null : FREE_LIMIT,
    memoryCount,
  })
}
