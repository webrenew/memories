import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { checkRateLimit, getClientIp, publicRateLimit } from "@/lib/rate-limit"
import { parseBody, cliAuthPollSchema, cliAuthApproveSchema } from "@/lib/validations"

export async function POST(request: Request): Promise<Response> {
  const rateLimited = await checkRateLimit(publicRateLimit, getClientIp(request))
  if (rateLimited) return rateLimited

  const body = await request.json().catch(() => ({}))

  if (body.action === "poll") {
    const parsed = parseBody(cliAuthPollSchema, body)
    if (!parsed.success) return parsed.response

    // CLI is polling for its token — look up by cli_auth_code in the database
    const admin = createAdminClient()
    const { data: user, error: userError } = await admin
      .from("users")
      .select("cli_token, email, id")
      .eq("cli_auth_code", parsed.data.code)
      .maybeSingle()

    if (userError) {
      console.error("CLI auth poll lookup failed:", userError)
      return NextResponse.json({ error: "Failed to check auth status" }, { status: 500 })
    }

    if (!user || !user.cli_token) {
      // Still waiting or code not found
      return NextResponse.json({ status: "pending" }, { status: 202 })
    }

    // Resolve email — fall back to auth.users if custom table has no email
    let email = user.email
    if (!email && user.id) {
      const { data: authData } = await admin.auth.admin.getUserById(user.id)
      email = authData?.user?.email ?? null
    }

    // Clear the auth code so it can't be reused
    const { error: clearCodeError } = await admin
      .from("users")
      .update({ cli_auth_code: null })
      .eq("cli_auth_code", parsed.data.code)

    if (clearCodeError) {
      console.error("Failed to clear CLI auth code after token poll:", clearCodeError)
      return NextResponse.json({ error: "Failed to finalize token exchange" }, { status: 500 })
    }

    return NextResponse.json({
      token: user.cli_token,
      email,
    })
  }

  if (body.action === "approve") {
    const parsed = parseBody(cliAuthApproveSchema, body)
    if (!parsed.success) return parsed.response

    // Browser is approving the CLI auth
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Generate a CLI token
    const cliToken = `cli_${randomBytes(32).toString("hex")}`

    // Save token and auth code to user's row
    const admin = createAdminClient()
    const { error } = await admin
      .from("users")
      .update({ cli_token: cliToken, cli_auth_code: parsed.data.code })
      .eq("id", user.id)

    if (error) {
      return NextResponse.json(
        { error: "Failed to create token" },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 })
}
