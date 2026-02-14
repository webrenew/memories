import React from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { TeamContent } from "./team-content"

export const metadata = {
  title: "Team",
}

export default async function TeamPage(): Promise<React.JSX.Element> {
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

  interface Organization {
    id: string
    name: string
    slug: string
    owner_id: string
    plan: string
    created_at: string
  }

  const organizations = memberships?.map(m => {
    const org = m.organization as Organization | Organization[] | null
    const orgData = Array.isArray(org) ? org[0] : org
    return {
      ...(orgData || { id: "", name: "", slug: "", owner_id: "", plan: "", created_at: "" }),
      role: m.role,
    }
  }).filter(o => o.id) || []

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
