import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

// GET /api/orgs - List user's organizations
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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

  const body = await request.json()
  const { name } = body

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return NextResponse.json({ error: "Organization name must be at least 2 characters" }, { status: 400 })
  }

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
      name: name.trim(),
      slug,
      owner_id: user.id,
    })
    .select()
    .single()

  if (orgError) {
    return NextResponse.json({ error: orgError.message }, { status: 500 })
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
    // Rollback org creation
    await supabase.from("organizations").delete().eq("id", org.id)
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  // Set as user's current org if they don't have one
  await supabase
    .from("users")
    .update({ current_org_id: org.id })
    .eq("id", user.id)
    .is("current_org_id", null)

  return NextResponse.json({ organization: org }, { status: 201 })
}
