import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

// GET /api/orgs/[orgId]/members - List organization members
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Check user is member
  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 })
  }

  const { data: members, error } = await supabase
    .from("org_members")
    .select(`
      id,
      role,
      joined_at,
      user:users(id, email, name, avatar_url)
    `)
    .eq("org_id", orgId)
    .order("joined_at", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ members })
}

// DELETE /api/orgs/[orgId]/members?userId=xxx - Remove member
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const { searchParams } = new URL(request.url)
  const targetUserId = searchParams.get("userId")

  if (!targetUserId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Check current user's role
  const { data: currentMembership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (!currentMembership) {
    return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 })
  }

  // Get target user's membership
  const { data: targetMembership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", targetUserId)
    .single()

  if (!targetMembership) {
    return NextResponse.json({ error: "User is not a member" }, { status: 404 })
  }

  // Can't remove the owner
  if (targetMembership.role === "owner") {
    return NextResponse.json({ error: "Cannot remove the organization owner" }, { status: 400 })
  }

  // Users can remove themselves, or admins/owners can remove others
  const canRemove = 
    targetUserId === user.id || 
    ["owner", "admin"].includes(currentMembership.role)

  if (!canRemove) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const { error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", targetUserId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// PATCH /api/orgs/[orgId]/members - Update member role
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { userId, role } = body

  if (!userId || !role || !["admin", "member"].includes(role)) {
    return NextResponse.json({ error: "Invalid userId or role" }, { status: 400 })
  }

  // Check current user is owner or admin
  const { data: currentMembership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (!currentMembership || !["owner", "admin"].includes(currentMembership.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  // Can't change owner's role
  const { data: targetMembership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single()

  if (!targetMembership) {
    return NextResponse.json({ error: "User is not a member" }, { status: 404 })
  }

  if (targetMembership.role === "owner") {
    return NextResponse.json({ error: "Cannot change owner's role" }, { status: 400 })
  }

  // Only owner can promote to admin
  if (role === "admin" && currentMembership.role !== "owner") {
    return NextResponse.json({ error: "Only owner can promote to admin" }, { status: 403 })
  }

  const { error } = await supabase
    .from("org_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
