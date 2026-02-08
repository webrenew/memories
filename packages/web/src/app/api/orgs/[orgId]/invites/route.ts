import { createClient } from "@/lib/supabase/server"
import { sendTeamInviteEmail } from "@/lib/resend"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, createInviteSchema } from "@/lib/validations"

// GET /api/orgs/[orgId]/invites - List pending invites
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

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  // Check user is admin or owner
  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const { data: invites, error } = await supabase
    .from("org_invites")
    .select(`
      id,
      email,
      role,
      created_at,
      expires_at,
      inviter:users!invited_by(name, email)
    `)
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ invites })
}

// POST /api/orgs/[orgId]/invites - Create invite
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  // Check user is admin or owner
  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const parsed = parseBody(createInviteSchema, await request.json())
  if (!parsed.success) return parsed.response
  const { email, role } = parsed.data

  // Only owner can invite as admin
  if (role === "admin" && membership.role !== "owner") {
    return NextResponse.json({ error: "Only owner can invite as admin" }, { status: 403 })
  }

  // Check if email already a member
  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", email.toLowerCase())
    .single()

  if (existingUser) {
    const { data: existingMember } = await supabase
      .from("org_members")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", existingUser.id)
      .single()

    if (existingMember) {
      return NextResponse.json({ error: "User is already a member" }, { status: 400 })
    }
  }

  // Check for existing pending invite
  const { data: existingInvite } = await supabase
    .from("org_invites")
    .select("id")
    .eq("org_id", orgId)
    .eq("email", email.toLowerCase())
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single()

  if (existingInvite) {
    return NextResponse.json({ error: "Invite already pending for this email" }, { status: 400 })
  }

  // Create invite
  const { data: invite, error } = await supabase
    .from("org_invites")
    .insert({
      org_id: orgId,
      email: email.toLowerCase(),
      role,
      invited_by: user.id,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get org name and inviter name for email
  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single()

  const { data: inviter } = await supabase
    .from("users")
    .select("name, email")
    .eq("id", user.id)
    .single()

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://memories.sh"}/invite/accept?token=${invite.token}`

  // Send invite email
  if (process.env.RESEND_API_KEY) {
    try {
      await sendTeamInviteEmail({
        to: email.toLowerCase(),
        inviterName: inviter?.name || inviter?.email?.split("@")[0] || "Someone",
        orgName: org?.name || "an organization",
        inviteUrl,
        role,
      })
    } catch (e) {
      console.error("Failed to send invite email:", e)
      // Don't fail the request - invite was created, email just didn't send
    }
  }

  return NextResponse.json({ 
    invite,
    inviteUrl,
    emailSent: !!process.env.RESEND_API_KEY,
    message: process.env.RESEND_API_KEY 
      ? `Invite sent to ${email}` 
      : `Invite created. Share this link: ${inviteUrl}` 
  }, { status: 201 })
}

// DELETE /api/orgs/[orgId]/invites?inviteId=xxx - Revoke invite
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const { searchParams } = new URL(request.url)
  const inviteId = searchParams.get("inviteId")

  if (!inviteId) {
    return NextResponse.json({ error: "inviteId is required" }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  // Check user is admin or owner
  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const { error } = await supabase
    .from("org_invites")
    .delete()
    .eq("id", inviteId)
    .eq("org_id", orgId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
