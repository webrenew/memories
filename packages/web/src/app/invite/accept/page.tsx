import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AcceptInviteContent } from "./accept-content"

export const metadata = {
  title: "Accept Invite",
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  if (!token) {
    redirect("/")
  }

  const supabase = await createClient()
  
  // Get invite details
  const { data: invite } = await supabase
    .from("org_invites")
    .select(`
      id,
      email,
      role,
      expires_at,
      accepted_at,
      organization:organizations(id, name, slug)
    `)
    .eq("token", token)
    .single()

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

  const org = invite.organization as { id: string; name: string; slug: string }

  return (
    <AcceptInviteContent
      token={token}
      orgName={org.name}
      role={invite.role}
      email={invite.email}
      isLoggedIn={!!user}
      userEmail={user?.email}
    />
  )
}
