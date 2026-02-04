import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { TeamContent } from "./team-content"

export const metadata = {
  title: "Team",
}

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  // Get user's organizations with member counts
  const { data: memberships } = await supabase
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

  const organizations = memberships?.map(m => ({
    ...m.organization as {
      id: string
      name: string
      slug: string
      owner_id: string
      plan: string
      created_at: string
    },
    role: m.role,
  })) || []

  // Get user's current org
  const { data: profile } = await supabase
    .from("users")
    .select("current_org_id")
    .eq("id", user.id)
    .single()

  return (
    <TeamContent 
      organizations={organizations}
      currentOrgId={profile?.current_org_id}
      userId={user.id}
    />
  )
}
