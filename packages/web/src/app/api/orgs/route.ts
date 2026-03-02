import { authenticateRequest } from "@/lib/auth"
import { logOrgAuditEvent } from "@/lib/org-audit"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { apiRateLimit, checkPreAuthApiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, createOrgSchema } from "@/lib/validations"

const MAX_SLUG_INSERT_RETRIES = 10

function isDuplicateSlugError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : ""
  if (code === "23505") return true

  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return message.includes("duplicate key") && message.includes("slug")
}

// GET /api/orgs - List user's organizations
export async function GET(request: Request): Promise<Response> {
  const preAuthRateLimited = await checkPreAuthApiRateLimit(request)
  if (preAuthRateLimited) return preAuthRateLimited

  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  const { data: orgs, error } = await admin
    .from("org_members")
    .select(`
      role,
      organization:organizations(
        id,
        name,
        slug,
        owner_id,
        plan,
        created_at
      )
    `)
    .eq("user_id", auth.userId)

  if (error) {
    console.error("Failed to load user organizations:", {
      error,
      userId: auth.userId,
    })
    return NextResponse.json({ error: "Failed to load organizations" }, { status: 500 })
  }

  const organizations = orgs?.map(m => ({
    ...m.organization,
    role: m.role,
  })) || []

  return NextResponse.json({ organizations })
}

// POST /api/orgs - Create a new organization
export async function POST(request: Request): Promise<Response> {
  const preAuthRateLimited = await checkPreAuthApiRateLimit(request)
  if (preAuthRateLimited) return preAuthRateLimited

  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const parsed = parseBody(createOrgSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response
  const { name } = parsed.data

  const admin = createAdminClient()

  // Generate slug from name
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  let slug = baseSlug || "workspace"
  let counter = 1

  let org: { id: string; name: string; slug: string } | null = null
  let orgInsertError: unknown = null

  for (let attempt = 0; attempt < MAX_SLUG_INSERT_RETRIES; attempt += 1) {
    const response = await admin
      .from("organizations")
      .insert({
        name,
        slug,
        owner_id: auth.userId,
      })
      .select()
      .single()

    if (!response.error && response.data) {
      org = response.data as { id: string; name: string; slug: string }
      orgInsertError = null
      break
    }

    if (isDuplicateSlugError(response.error)) {
      slug = `${baseSlug || "workspace"}-${counter++}`
      orgInsertError = response.error
      continue
    }

    orgInsertError = response.error
    break
  }

  if (!org) {
    console.error("Failed to create organization:", {
      error: orgInsertError,
      userId: auth.userId,
      orgName: name.trim(),
      slug,
      retries: MAX_SLUG_INSERT_RETRIES,
    })
    return NextResponse.json({ error: "Failed to create organization" }, { status: 500 })
  }

  // Add creator as owner member
  const { error: memberError } = await admin
    .from("org_members")
    .insert({
      org_id: org.id,
      user_id: auth.userId,
      role: "owner",
    })

  if (memberError) {
    console.error("Failed to add owner as member:", {
      error: memberError,
      userId: auth.userId,
      orgId: org.id,
      message: memberError.message,
      code: memberError.code,
      details: memberError.details,
      hint: memberError.hint,
    })
    // Rollback org creation
    const { error: deleteError } = await admin.from("organizations").delete().eq("id", org.id)
    if (deleteError) {
      console.error("Failed to rollback org creation:", deleteError)
    }
    return NextResponse.json({ error: "Failed to add organization owner" }, { status: 500 })
  }

  // Set as user's current org if they don't have one
  await admin
    .from("users")
    .update({ current_org_id: org.id })
    .eq("id", auth.userId)
    .is("current_org_id", null)

  await logOrgAuditEvent({
    client: admin,
    orgId: org.id,
    actorUserId: auth.userId,
    action: "org_created",
    targetType: "organization",
    targetId: org.id,
    targetLabel: org.name ?? slug,
    metadata: {
      slug,
    },
  })

  return NextResponse.json(
    {
      organization: org,
      upgradeUrl: "/app/upgrade?plan=growth&source=org-created",
    },
    { status: 201 }
  )
}
