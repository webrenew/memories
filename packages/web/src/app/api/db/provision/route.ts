import { authenticateRequest } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createDatabase, createDatabaseToken, deleteDatabase, initSchema } from "@/lib/turso"
import { NextResponse } from "next/server"
import { setTimeout as delay } from "node:timers/promises"
import { checkPreAuthApiRateLimit, checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { resolveWorkspaceContext } from "@/lib/workspace"
import { getTursoOrgSlug } from "@/lib/env"

type SaveCredentialsResult =
  | { ok: true; alreadyProvisioned: false }
  | { ok: true; alreadyProvisioned: true; url: string }
  | { ok: false; error: unknown }

function applyNullFilter(query: {
  is?: (column: string, value: unknown) => unknown
  eq?: (column: string, value: unknown) => unknown
}, column: string) {
  if (typeof query.is === "function") {
    return query.is(column, null)
  }
  if (typeof query.eq === "function") {
    return query.eq(column, null)
  }
  return query
}

async function runClaimQuery(claimQuery: unknown): Promise<{ data: unknown; error: unknown }> {
  const candidate = claimQuery as {
    select?: (columns: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> }
  }
  if (typeof candidate?.select === "function") {
    return candidate.select("id").maybeSingle()
  }

  const fallback = await Promise.resolve(claimQuery as Promise<{ error?: unknown }>)
  if (fallback?.error) {
    return { data: null, error: fallback.error }
  }
  return { data: { id: "claimed" }, error: null }
}

async function saveProvisionedCredentials(params: {
  admin: ReturnType<typeof createAdminClient>
  ownerType: "organization" | "user"
  orgId: string | null
  userId: string
  url: string
  token: string
  dbName: string
}): Promise<SaveCredentialsResult> {
  const { admin, ownerType, orgId, userId, url, token, dbName } = params

  if (ownerType === "organization") {
    if (!orgId) {
      return { ok: false, error: new Error("Organization id missing while saving credentials") }
    }

    let claimQuery = admin
      .from("organizations")
      .update({ turso_db_url: url, turso_db_token: token, turso_db_name: dbName })
      .eq("id", orgId) as never

    claimQuery = applyNullFilter(claimQuery as never, "turso_db_url") as typeof claimQuery
    claimQuery = applyNullFilter(claimQuery as never, "turso_db_token") as typeof claimQuery

    const claim = await runClaimQuery(claimQuery)

    if (claim.error) {
      return { ok: false, error: claim.error }
    }
    if (claim.data) {
      return { ok: true, alreadyProvisioned: false }
    }

    const existing = await admin
      .from("organizations")
      .select("turso_db_url, turso_db_token")
      .eq("id", orgId)
      .maybeSingle()

    if (existing.error) {
      return { ok: false, error: existing.error }
    }
    if (existing.data?.turso_db_url && existing.data?.turso_db_token) {
      return { ok: true, alreadyProvisioned: true, url: existing.data.turso_db_url }
    }

    return { ok: false, error: new Error("Failed to claim provisioning lock for organization workspace") }
  }

  let claimQuery = admin
    .from("users")
    .update({ turso_db_url: url, turso_db_token: token, turso_db_name: dbName })
    .eq("id", userId) as never

  claimQuery = applyNullFilter(claimQuery as never, "turso_db_url") as typeof claimQuery
  claimQuery = applyNullFilter(claimQuery as never, "turso_db_token") as typeof claimQuery

  const claim = await runClaimQuery(claimQuery)

  if (claim.error) {
    return { ok: false, error: claim.error }
  }
  if (claim.data) {
    return { ok: true, alreadyProvisioned: false }
  }

  const existing = await admin
    .from("users")
    .select("turso_db_url, turso_db_token")
    .eq("id", userId)
    .maybeSingle()

  if (existing.error) {
    return { ok: false, error: existing.error }
  }
  if (existing.data?.turso_db_url && existing.data?.turso_db_token) {
    return { ok: true, alreadyProvisioned: true, url: existing.data.turso_db_url }
  }

  return { ok: false, error: new Error("Failed to claim provisioning lock for user workspace") }
}

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

    const saveResult = await saveProvisionedCredentials({
      admin,
      ownerType: context.ownerType,
      orgId: context.orgId ?? null,
      userId: auth.userId,
      url,
      token,
      dbName: db.name,
    })

    if (!saveResult.ok) {
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

    if (saveResult.alreadyProvisioned) {
      if (createdDbName) {
        try {
          await deleteDatabase(tursoOrg, createdDbName)
        } catch (cleanupError) {
          console.error("Failed to cleanup duplicate Turso DB after concurrent provisioning:", cleanupError)
        }
      }
      return NextResponse.json({
        url: saveResult.url,
        provisioned: false,
      })
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
