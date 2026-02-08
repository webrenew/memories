import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, createOrgSchema } from "@/lib/validations"

// GET /api/orgs - List user's organizations
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const { data: orgs, error } = await supabase
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
    .eq("user_id", user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const organizations = orgs?.map(m => ({
    ...m.organization,
    role: m.role,
  })) || []

  return NextResponse.json({ organizations })
}

// POST /api/orgs - Create a new organization
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(createOrgSchema, await request.json())
  if (!parsed.success) return parsed.response
  const { name } = parsed.data

  // Generate slug from name
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  let slug = baseSlug
  let counter = 1

  // Check for slug uniqueness
  while (true) {
    const { data: existing } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .single()

    if (!existing) break
    slug = `${baseSlug}-${counter++}`
  }

  // Create organization
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({
      name,
      slug,
      owner_id: user.id,
    })
    .select()
    .single()

  if (orgError) {
    console.error("Failed to create organization:", {
      error: orgError,
      userId: user.id,
      orgName: name.trim(),
    })
    return NextResponse.json({ error: orgError.message || "Failed to create organization" }, { status: 500 })
  }

  // Add creator as owner member
  const { error: memberError } = await supabase
    .from("org_members")
    .insert({
      org_id: org.id,
      user_id: user.id,
      role: "owner",
    })

  if (memberError) {
    console.error("Failed to add owner as member:", {
      error: memberError,
      userId: user.id,
      orgId: org.id,
      message: memberError.message,
      code: memberError.code,
      details: memberError.details,
      hint: memberError.hint,
    })
    // Rollback org creation
    const { error: deleteError } = await supabase.from("organizations").delete().eq("id", org.id)
    if (deleteError) {
      console.error("Failed to rollback org creation:", deleteError)
    }
    return NextResponse.json({ 
      error: memberError.message || "Failed to add you as organization owner. This may be a permissions issue." 
    }, { status: 500 })
  }

  // Set as user's current org if they don't have one
  await supabase
    .from("users")
    .update({ current_org_id: org.id })
    .eq("id", user.id)
    .is("current_org_id", null)

  return NextResponse.json({ organization: org }, { status: 201 })
}
