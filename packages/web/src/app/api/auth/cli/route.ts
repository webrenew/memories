import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { checkRateLimit, getClientIp, publicRateLimit } from "@/lib/rate-limit"
import { parseBody, cliAuthPollSchema, cliAuthApproveSchema } from "@/lib/validations"
import { CLI_AUTH_CODE_TTL_MS, generateCliToken, hashCliToken } from "@/lib/cli-token"

export async function POST(request: Request): Promise<Response> {
  const rateLimited = await checkRateLimit(publicRateLimit, getClientIp(request))
  if (rateLimited) return rateLimited

  const body = await request.json().catch(() => ({}))

  if (body.action === "poll") {
    const parsed = parseBody(cliAuthPollSchema, body)
    if (!parsed.success) return parsed.response

    // CLI is polling for token exchange completion.
    const admin = createAdminClient()
    const { data: user, error: userError } = await admin
      .from("users")
      .select("email, id, cli_auth_expires_at")
      .eq("cli_auth_code", parsed.data.code)
      .maybeSingle()

    if (userError) {
      console.error("CLI auth poll lookup failed:", userError)
      return NextResponse.json({ error: "Failed to check auth status" }, { status: 500 })
    }

    if (!user) {
      // Still waiting or code not found.
      return NextResponse.json({ status: "pending" }, { status: 202 })
    }

    const expiresAt = user.cli_auth_expires_at ? new Date(user.cli_auth_expires_at).getTime() : 0
    if (!expiresAt || Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
      await admin
        .from("users")
        .update({ cli_auth_code: null, cli_auth_expires_at: null })
        .eq("id", user.id)
        .eq("cli_auth_code", parsed.data.code)

      return NextResponse.json(
        { error: "Authorization code expired. Run login again from the CLI." },
        { status: 410 }
      )
    }

    // Resolve email — fall back to auth.users if custom table has no email
    let email = user.email
    if (!email && user.id) {
      const { data: authData } = await admin.auth.admin.getUserById(user.id)
      email = authData?.user?.email ?? null
    }

    const cliToken = generateCliToken()
    const tokenHash = hashCliToken(cliToken)

    // Atomically consume auth code and persist token hash.
    const { data: finalizedUser, error: finalizeError } = await admin
      .from("users")
      .update({
        cli_token_hash: tokenHash,
        cli_token: null,
        cli_auth_code: null,
        cli_auth_expires_at: null,
      })
      .eq("id", user.id)
      .eq("cli_auth_code", parsed.data.code)
      .select("id")
      .maybeSingle()

    if (finalizeError) {
      console.error("Failed to finalize CLI token exchange:", finalizeError)
      return NextResponse.json({ error: "Failed to finalize token exchange" }, { status: 500 })
    }

    if (!finalizedUser) {
      return NextResponse.json({ status: "pending" }, { status: 202 })
    }

    return NextResponse.json({
      token: cliToken,
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

    const expiresAt = new Date(Date.now() + CLI_AUTH_CODE_TTL_MS).toISOString()

    // Save auth code and expiry to user's row.
    const admin = createAdminClient()
    const { error } = await admin
      .from("users")
      .update({ cli_auth_code: parsed.data.code, cli_auth_expires_at: expiresAt })
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
