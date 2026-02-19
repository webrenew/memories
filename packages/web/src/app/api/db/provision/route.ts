import { authenticateRequest } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createDatabase, createDatabaseToken, deleteDatabase, initSchema } from "@/lib/turso"
import { NextResponse } from "next/server"
import { setTimeout as delay } from "node:timers/promises"
import { checkPreAuthApiRateLimit, checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { resolveWorkspaceContext } from "@/lib/workspace"
import { getTursoOrgSlug } from "@/lib/env"

export async function POST(request: Request): Promise<Response> {
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

  const tursoOrg = getTursoOrgSlug()
  let createdDbName: string | null = null

  try {
    // Create a new Turso database
    const db = await createDatabase(tursoOrg)
    createdDbName = db.name
    const token = await createDatabaseToken(tursoOrg, db.name)
    const url = `libsql://${db.hostname}`

    // Wait for Turso to finish provisioning
    await delay(3000)

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
      if (createdDbName) {
        try {
          await deleteDatabase(tursoOrg, createdDbName)
        } catch (cleanupError) {
          console.error("Failed to cleanup orphaned Turso DB after credential save failure:", cleanupError)
        }
      }
      return NextResponse.json(
        { error: "Failed to save database credentials" },
        { status: 500 }
      )
    }

    return NextResponse.json({ url, provisioned: true })
  } catch (err) {
    console.error("Provisioning error:", err)
    if (createdDbName) {
      try {
        await deleteDatabase(tursoOrg, createdDbName)
      } catch (cleanupError) {
        console.error("Failed to cleanup orphaned Turso DB after provisioning error:", cleanupError)
      }
    }
    return NextResponse.json(
      { error: "Failed to provision database" },
      { status: 500 }
    )
  }
}
