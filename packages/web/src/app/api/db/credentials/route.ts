import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { authenticateRequest } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 })
  }

  const bearer = authHeader.slice(7)
  const rateLimited = await checkRateLimit(apiRateLimit, bearer)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  let user: { turso_db_url: string | null; turso_db_token: string | null; turso_db_name: string | null } | null = null
  let error: unknown = null

  // Bearer mcp_* is used by hosted MCP and --api-key flows.
  if (bearer.startsWith("mcp_")) {
    const res = await admin
      .from("users")
      .select("turso_db_url, turso_db_token, turso_db_name")
      .eq("mcp_api_key", bearer)
      .single()
    user = res.data
    error = res.error
  } else {
    // Bearer cli_* (or session cookies) is used by CLI login/sync flows.
    const auth = await authenticateRequest(request)
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const res = await admin
      .from("users")
      .select("turso_db_url, turso_db_token, turso_db_name")
      .eq("id", auth.userId)
      .single()
    user = res.data
    error = res.error
  }

  if (error || !user) {
    console.error("Credentials lookup error:", error)
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  if (!user.turso_db_url || !user.turso_db_token) {
    return NextResponse.json({ error: "Database not provisioned" }, { status: 400 })
  }

  // Return both canonical and legacy keys for compatibility with existing clients.
  return NextResponse.json({
    url: user.turso_db_url,
    token: user.turso_db_token,
    dbName: user.turso_db_name,
    turso_db_url: user.turso_db_url,
    turso_db_token: user.turso_db_token,
    turso_db_name: user.turso_db_name,
  })
}
