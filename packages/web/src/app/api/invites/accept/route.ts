import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logOrgAuditEvent } from "@/lib/org-audit"
import { addTeamSeat } from "@/lib/stripe/teams"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, acceptInviteSchema } from "@/lib/validations"
import { getInviteTokenCandidates } from "@/lib/team-invites"
import { hasServiceRoleKey } from "@/lib/env"

// POST /api/invites/accept - Accept an invite
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(acceptInviteSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response
  const { token, billing } = parsed.data
  const tokenCandidates = getInviteTokenCandidates(token)
  const inviteToken = tokenCandidates[0] ?? token.trim()
  const adminSupabase = hasServiceRoleKey() ? createAdminClient() : null
  const inviteLookup = adminSupabase ?? supabase

  // Find invite with org details
  const { data: invite, error: inviteError } = await inviteLookup
    .from("org_invites")
    .select("*, organization:organizations(id, name, slug, stripe_customer_id, stripe_subscription_id)")
    .in("token", tokenCandidates)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()

  if (inviteError) {
    console.error("Invite accept lookup failed", {
      message: inviteError.message,
      code: inviteError.code,
      tokenPrefix: inviteToken.slice(0, 8),
    })
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 })
  }

  if (!invite) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 })
  }

  // Get all emails from user's linked identities
  const userEmails = new Set<string>()
  
  // Primary email from auth
  if (user.email) {
    userEmails.add(user.email.toLowerCase())
  }
  
  // Emails from linked identities (GitHub, Google, etc.)
  if (user.identities) {
    for (const identity of user.identities) {
      const identityEmail = identity.identity_data?.email
      if (identityEmail && typeof identityEmail === "string") {
        userEmails.add(identityEmail.toLowerCase())
      }
    }
  }

  // Verify any linked email matches the invite
  const inviteEmailLower = invite.email.toLowerCase()
  if (!userEmails.has(inviteEmailLower)) {
    const linkedEmails = Array.from(userEmails).join(", ")
    return NextResponse.json({ 
      error: `This invite was sent to ${invite.email}. Your account is linked to: ${linkedEmails}. You can link this email by signing in with it.` 
    }, { status: 403 })
  }

  // Check if already a member
  const { data: existingMember } = await supabase
    .from("org_members")
    .select("id")
    .eq("org_id", invite.org_id)
    .eq("user_id", user.id)
    .single()

  if (existingMember) {
    return NextResponse.json({ error: "You are already a member of this organization" }, { status: 400 })
  }

  const org = invite.organization as {
    id: string
    name: string
    slug: string
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
  }

  // Mark invite as accepted FIRST to prevent race conditions
  const writeClient = adminSupabase ?? supabase
  const { error: acceptError } = await writeClient
    .from("org_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("accepted_at", null) // Only update if not already accepted

  if (acceptError) {
    console.error("Failed to mark invite as accepted:", acceptError)
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 })
  }

  // Add as member
  const { error: memberError } = await writeClient
    .from("org_members")
    .insert({
      org_id: invite.org_id,
      user_id: user.id,
      role: invite.role,
      invited_by: invite.invited_by,
    })

  if (memberError) {
    console.error("Failed to insert org member during invite accept:", {
      inviteId: invite.id,
      orgId: invite.org_id,
      userId: user.id,
      error: memberError,
    })
    // Rollback invite acceptance if member insert fails
    await writeClient
      .from("org_invites")
      .update({ accepted_at: null })
      .eq("id", invite.id)
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 })
  }

  await logOrgAuditEvent({
    client: writeClient,
    orgId: invite.org_id,
    actorUserId: user.id,
    action: "org_invite_accepted",
    targetType: "user",
    targetId: user.id,
    targetLabel: invite.email,
    metadata: {
      inviteId: invite.id,
      role: invite.role,
    },
  })

  // Set as user's current org if they don't have one
  const { error: orgError } = await writeClient
    .from("users")
    .update({ current_org_id: invite.org_id })
    .eq("id", user.id)
    .is("current_org_id", null)

  if (orgError) {
    console.error("Failed to set current org:", orgError)
    // Non-critical, continue
  }

  // Add seat to org subscription after membership is committed.
  // This avoids charging seats for failed invite acceptance flows.
  try {
    const result = await addTeamSeat({
      orgId: org.id,
      stripeCustomerId: org.stripe_customer_id,
      stripeSubscriptionId: org.stripe_subscription_id,
      billing: billing as "monthly" | "annual",
    })

    if (result.action === "created") {
      await writeClient
        .from("organizations")
        .update({ stripe_subscription_id: result.subscriptionId })
        .eq("id", org.id)
    }
  } catch (e) {
    console.error("Failed to add team seat after invite acceptance:", e)
    // Non-blocking: billing can reconcile from org membership.
  }

  return NextResponse.json({ 
    success: true,
    organization: { id: org.id, name: org.name, slug: org.slug }
  })
}
