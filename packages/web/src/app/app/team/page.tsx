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

  const [membershipsResult, profileResult] = await Promise.all([
    supabase
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
      .eq("user_id", user.id),
    supabase
      .from("users")
      .select("current_org_id")
      .eq("id", user.id)
      .single(),
  ])
  const { data: memberships } = membershipsResult

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

  const { data: profile } = profileResult

  return (
    <TeamContent 
      organizations={organizations}
      currentOrgId={profile?.current_org_id}
      userId={user.id}
    />
  )
}
