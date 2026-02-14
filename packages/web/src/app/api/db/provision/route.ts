import { authenticateRequest } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createDatabase, createDatabaseToken, initSchema } from "@/lib/turso"
import { NextResponse } from "next/server"
import { checkPreAuthApiRateLimit, checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { resolveWorkspaceContext } from "@/lib/workspace"

const TURSO_ORG = "webrenew"

export async function POST(request: Request) {
  const preAuthRateLimited = await checkPreAuthApiRateLimit(request)
  if (preAuthRateLimited) return preAuthRateLimited

  const auth = await authenticateRequest(request)

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(strictRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  let context = await resolveWorkspaceContext(admin, auth.userId, {
    fallbackToUserWithoutOrgCredentials: false,
  })

  // Ensure user row exists (trigger may not have fired yet).
  if (!context) {
    const { error: insertError } = await admin
      .from("users")
      .upsert({ id: auth.userId, email: auth.email }, { onConflict: "id" })

    if (insertError) {
      console.error("Failed to create user row:", insertError)
      return NextResponse.json(
        { error: "Failed to initialize user" },
        { status: 500 }
      )
    }

    context = await resolveWorkspaceContext(admin, auth.userId, {
      fallbackToUserWithoutOrgCredentials: false,
    })
  }

  if (!context) {
    return NextResponse.json(
      { error: "Failed to resolve active memory target" },
      { status: 500 }
    )
  }

  if (context.hasDatabase && context.turso_db_url && context.turso_db_token) {
    return NextResponse.json({
      url: context.turso_db_url,
      provisioned: false,
    })
  }

  if (!context.canProvision) {
    return NextResponse.json(
      { error: "Only owners or admins can provision organization memory" },
      { status: 403 }
    )
  }

  if (context.ownerType === "organization" && !context.orgId) {
    return NextResponse.json(
      { error: "Failed to resolve organization context" },
      { status: 500 }
    )
  }

  try {
    // Create a new Turso database
    const db = await createDatabase(TURSO_ORG)
    const token = await createDatabaseToken(TURSO_ORG, db.name)
    const url = `libsql://${db.hostname}`

    // Wait for Turso to finish provisioning
    await new Promise((r) => setTimeout(r, 3000))

    // Initialize the schema
    await initSchema(url, token)

    let error: { message?: string } | null = null
    if (context.ownerType === "organization" && context.orgId) {
      const res = await admin
        .from("organizations")
        .update({ turso_db_url: url, turso_db_token: token, turso_db_name: db.name })
        .eq("id", context.orgId)
      error = res.error
    } else {
      const res = await admin
        .from("users")
        .update({ turso_db_url: url, turso_db_token: token, turso_db_name: db.name })
        .eq("id", auth.userId)
      error = res.error
    }

    if (error) {
      return NextResponse.json(
        { error: "Failed to save database credentials" },
        { status: 500 }
      )
    }

    return NextResponse.json({ url, provisioned: true })
  } catch (err) {
    console.error("Provisioning error:", err)
    return NextResponse.json(
      { error: "Failed to provision database" },
      { status: 500 }
    )
  }
}
