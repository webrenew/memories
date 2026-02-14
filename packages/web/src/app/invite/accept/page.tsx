import React from "react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getInviteTokenCandidates } from "@/lib/team-invites"
import { redirect } from "next/navigation"
import { AcceptInviteContent } from "./accept-content"

export const metadata = {
  title: "Accept Invite",
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}): Promise<React.JSX.Element> {
  const { token } = await searchParams

  if (!token) {
    redirect("/")
  }

  const tokenCandidates = getInviteTokenCandidates(token)
  const inviteToken = tokenCandidates[0] ?? token.trim()
  const adminSupabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
  const supabase = await createClient()
  
  // Get invite details
  const inviteLookup = adminSupabase ?? supabase
  const { data: invite, error: inviteError } = await inviteLookup
    .from("org_invites")
    .select(`
      id,
      token,
      email,
      role,
      expires_at,
      accepted_at,
      organization:organizations(id, name, slug)
    `)
    .in("token", tokenCandidates)
    .maybeSingle()

  if (inviteError) {
    console.error("Invite lookup failed on accept page", {
      message: inviteError.message,
      code: inviteError.code,
      tokenPrefix: inviteToken.slice(0, 8),
    })
  }

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Invalid Invite</h1>
          <p className="text-muted-foreground">This invite link is invalid or has been revoked.</p>
        </div>
      </div>
    )
  }

  if (invite.accepted_at) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Invite Already Used</h1>
          <p className="text-muted-foreground">This invite has already been accepted.</p>
        </div>
      </div>
    )
  }

  if (new Date(invite.expires_at) < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Invite Expired</h1>
          <p className="text-muted-foreground">This invite link has expired. Please ask for a new one.</p>
        </div>
      </div>
    )
  }

  // Check if user is logged in
  const { data: { user } } = await supabase.auth.getUser()

  // Collect all linked emails from user's identities
  const userEmails: string[] = []
  if (user) {
    if (user.email) {
      userEmails.push(user.email.toLowerCase())
    }
    if (user.identities) {
      for (const identity of user.identities) {
        const identityEmail = identity.identity_data?.email as string | undefined
        if (identityEmail && !userEmails.includes(identityEmail.toLowerCase())) {
          userEmails.push(identityEmail.toLowerCase())
        }
      }
    }
  }

  type OrgData = { id: string; name: string; slug: string }
  const orgRaw = invite.organization as OrgData | OrgData[] | null
  const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw

  if (!org) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Invalid Invite</h1>
          <p className="text-muted-foreground">Organization not found.</p>
        </div>
      </div>
    )
  }

  return (
    <AcceptInviteContent
      token={invite.token}
      orgName={org.name}
      role={invite.role}
      email={invite.email}
      isLoggedIn={!!user}
      userEmails={userEmails}
    />
  )
}
