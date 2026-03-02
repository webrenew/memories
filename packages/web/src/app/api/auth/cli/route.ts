import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { checkRateLimit, getClientIp, publicRateLimit } from "@/lib/rate-limit"
import { parseBody, cliAuthPollSchema, cliAuthApproveSchema } from "@/lib/validations"
import { CLI_AUTH_CODE_TTL_MS, generateCliToken, hashCliToken } from "@/lib/cli-token"

function isMissingFunctionError(error: unknown, functionName: string): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""
  const fn = functionName.toLowerCase()

  return (
    message.includes(fn) &&
    (message.includes("does not exist") ||
      message.includes("function") ||
      message.includes("could not find"))
  )
}

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

    const admin = createAdminClient()
    const { data: approveResult, error: approveError } = await admin.rpc("approve_cli_auth_code_atomic", {
      p_user_id: user.id,
      p_code: parsed.data.code,
      p_expires_at: expiresAt,
    })

    if (approveError) {
      if (isMissingFunctionError(approveError, "approve_cli_auth_code_atomic")) {
        return NextResponse.json(
          { error: "CLI auth approve guard is not available yet. Run the latest database migration first." },
          { status: 503 }
        )
      }
      return NextResponse.json(
        { error: "Failed to create token" },
        { status: 500 }
      )
    }

    if (approveResult === "code_in_use") {
      return NextResponse.json(
        { error: "Another CLI login request is already pending for this account. Complete it or wait for expiry." },
        { status: 409 }
      )
    }

    if (approveResult !== "updated") {
      return NextResponse.json(
        { error: "Failed to create token" },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 })
}
