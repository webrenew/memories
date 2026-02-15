import { authenticateRequest } from "@/lib/auth"
import { logOrgAuditEvent } from "@/lib/org-audit"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { apiRateLimit, checkPreAuthApiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, createOrgSchema } from "@/lib/validations"

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
  let slug = baseSlug
  let counter = 1

  // Check for slug uniqueness
  while (true) {
    const { data: existing, error: existingError } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle()

    if (existingError) {
      console.error("Failed to verify organization slug uniqueness:", {
        error: existingError,
        slug,
        userId: auth.userId,
      })
      return NextResponse.json({ error: "Failed to create organization" }, { status: 500 })
    }

    if (!existing) break
    slug = `${baseSlug}-${counter++}`
  }

  // Create organization
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name,
      slug,
      owner_id: auth.userId,
    })
    .select()
    .single()

  if (orgError) {
    console.error("Failed to create organization:", {
      error: orgError,
      userId: auth.userId,
      orgName: name.trim(),
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
    return NextResponse.json({ 
      error: memberError.message || "Failed to add you as organization owner. This may be a permissions issue." 
    }, { status: 500 })
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

  return NextResponse.json({ organization: org }, { status: 201 })
}
