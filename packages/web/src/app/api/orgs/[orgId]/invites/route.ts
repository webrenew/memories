import { createClient } from "@/lib/supabase/server"
import { logOrgAuditEvent } from "@/lib/org-audit"
import { sendTeamInviteEmail } from "@/lib/resend"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, createInviteSchema } from "@/lib/validations"
import { getTeamInviteExpiresAt } from "@/lib/team-invites"
import { getAppUrl, hasResendApiKey } from "@/lib/env"

// GET /api/orgs/[orgId]/invites - List pending invites
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
): Promise<Response> {
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
): Promise<Response> {
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

  const parsed = parseBody(createInviteSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response
  const { email, role } = parsed.data

  // Only owner can invite as admin
  if (role === "admin" && membership.role !== "owner") {
    return NextResponse.json({ error: "Only owner can invite as admin" }, { status: 403 })
  }

  // Check if any account with this email is already a member.
  const { data: existingUsers } = await supabase
    .from("users")
    .select("id")
    .ilike("email", email.toLowerCase())

  if (existingUsers && existingUsers.length > 0) {
    const existingUserIds = existingUsers.map((u) => u.id)
    const { data: existingMember, error: existingMemberError } = await supabase
      .from("org_members")
      .select("id")
      .eq("org_id", orgId)
      .in("user_id", existingUserIds)
      .limit(1)
      .maybeSingle()

    if (existingMemberError) {
      return NextResponse.json({ error: existingMemberError.message }, { status: 500 })
    }

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
      expires_at: getTeamInviteExpiresAt(),
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

  const inviteUrl = `${getAppUrl()}/invite/accept?token=${invite.token}`

  // Send invite email
  const emailSent = hasResendApiKey()
  if (emailSent) {
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

  await logOrgAuditEvent({
    client: supabase,
    orgId,
    actorUserId: user.id,
    action: "org_invite_created",
    targetType: "invite",
    targetId: invite.id,
    targetLabel: email.toLowerCase(),
    metadata: {
      role,
      expiresAt: invite.expires_at,
      emailSent,
    },
  })

  return NextResponse.json({ 
    invite,
    inviteUrl,
    emailSent,
    message: emailSent
      ? `Invite sent to ${email}`
      : `Invite created. Share this link: ${inviteUrl}`
  }, { status: 201 })
}

// DELETE /api/orgs/[orgId]/invites?inviteId=xxx - Revoke invite
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
): Promise<Response> {
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

  const { data: inviteToRevoke } = await supabase
    .from("org_invites")
    .select("id, email, role")
    .eq("id", inviteId)
    .eq("org_id", orgId)
    .maybeSingle()

  const { error } = await supabase
    .from("org_invites")
    .delete()
    .eq("id", inviteId)
    .eq("org_id", orgId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (inviteToRevoke) {
    await logOrgAuditEvent({
      client: supabase,
      orgId,
      actorUserId: user.id,
      action: "org_invite_revoked",
      targetType: "invite",
      targetId: inviteToRevoke.id,
      targetLabel: inviteToRevoke.email,
      metadata: {
        role: inviteToRevoke.role,
      },
    })
  }

  return NextResponse.json({ success: true })
}
