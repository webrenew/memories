import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

// POST /api/invites/accept - Accept an invite
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { token } = body

  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 })
  }

  // Find invite
  const { data: invite, error: inviteError } = await supabase
    .from("org_invites")
    .select("*, organization:organizations(id, name, slug)")
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single()

  if (inviteError || !invite) {
    return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 })
  }

  // Get user's email
  const { data: profile } = await supabase
    .from("users")
    .select("email")
    .eq("id", user.id)
    .single()

  // Verify email matches (case insensitive)
  if (profile?.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json({ 
      error: `This invite was sent to ${invite.email}. Please sign in with that email address.` 
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
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  // Mark invite as accepted
  await supabase
    .from("org_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id)

  // Set as user's current org if they don't have one
  await supabase
    .from("users")
    .update({ current_org_id: invite.org_id })
    .eq("id", user.id)
    .is("current_org_id", null)

  return NextResponse.json({ 
    success: true,
    organization: invite.organization 
  })
}
