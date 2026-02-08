import { createClient } from "@/lib/supabase/server"
import { addTeamSeat } from "@/lib/stripe/teams"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, acceptInviteSchema } from "@/lib/validations"

// POST /api/invites/accept - Accept an invite
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(acceptInviteSchema, await request.json())
  if (!parsed.success) return parsed.response
  const { token, billing } = parsed.data

  // Find invite with org details
  const { data: invite, error: inviteError } = await supabase
    .from("org_invites")
    .select("*, organization:organizations(id, name, slug, owner_id, stripe_subscription_id)")
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single()

  if (inviteError || !invite) {
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
    owner_id: string
    stripe_subscription_id: string | null
  }

  // Get org owner's Stripe customer ID
  const { data: owner } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", org.owner_id)
    .single()

  // Add seat to org's subscription (or create one)
  const subscriptionId = org.stripe_subscription_id
  try {
    const result = await addTeamSeat({
      orgId: org.id,
      stripeCustomerId: owner?.stripe_customer_id || null,
      stripeSubscriptionId: subscriptionId,
      billing: billing as "monthly" | "annual",
    })

    // If new subscription created, save it to org
    if (result.action === "created") {
      await supabase
        .from("organizations")
        .update({ stripe_subscription_id: result.subscriptionId })
        .eq("id", org.id)
    }
  } catch (e) {
    console.error("Failed to add team seat:", e)
    // Don't block invite acceptance if billing fails - can reconcile later
    // In production you might want to handle this differently
  }

  // Mark invite as accepted FIRST to prevent race conditions
  const { error: acceptError } = await supabase
    .from("org_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("accepted_at", null) // Only update if not already accepted

  if (acceptError) {
    console.error("Failed to mark invite as accepted:", acceptError)
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 })
  }

  // Add as member
  const { error: memberError } = await supabase
    .from("org_members")
    .insert({
      org_id: invite.org_id,
      user_id: user.id,
      role: invite.role,
      invited_by: invite.invited_by,
    })

  if (memberError) {
    // Rollback invite acceptance if member insert fails
    await supabase
      .from("org_invites")
      .update({ accepted_at: null })
      .eq("id", invite.id)
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  // Set as user's current org if they don't have one
  const { error: orgError } = await supabase
    .from("users")
    .update({ current_org_id: invite.org_id })
    .eq("id", user.id)
    .is("current_org_id", null)

  if (orgError) {
    console.error("Failed to set current org:", orgError)
    // Non-critical, continue
  }

  return NextResponse.json({ 
    success: true,
    organization: { id: org.id, name: org.name, slug: org.slug }
  })
}
