import React from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/dashboard/DashboardShell"
import { resolveWorkspaceContext } from "@/lib/workspace"
import type { OrgMembership } from "@/components/dashboard/WorkspaceSwitcher"
import { autoJoinOrganizationsForEmails } from "@/lib/domain-auto-join"
import { syncGithubAccountLink } from "@/lib/github-account-links"
import { hasServiceRoleKey } from "@/lib/env"

export const metadata = {
  title: "Dashboard",
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}): Promise<React.JSX.Element> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  if (hasServiceRoleKey() && user.email) {
    void autoJoinOrganizationsForEmails({
      userId: user.id,
      emails: [user.email],
    })
      .catch((error) => {
        // Do not block dashboard render when background auto-join fails.
        console.error("Dashboard auto-join failed:", error)
      })

    void syncGithubAccountLink(user).catch((error) => {
      // Keep dashboard available when account link sync fails.
      console.error("Dashboard github account link sync failed:", error)
    })
  }

  const [workspace, profile, membershipRows] = await Promise.all([
    resolveWorkspaceContext(supabase, user.id),
    supabase
      .from("users")
      .select("id, email, name, avatar_url")
      .eq("id", user.id)
      .single()
      .then((r) => r.data),
    supabase
      .from("org_members")
      .select("role, organizations(id, name, slug)")
      .eq("user_id", user.id)
      .then((r) => r.data),
  ])

  const memberships: OrgMembership[] = (membershipRows ?? [])
    .filter((row): row is typeof row & { organizations: { id: string; name: string; slug: string } } =>
      row.organizations !== null && typeof row.organizations === "object" && !Array.isArray(row.organizations)
    )
    .map((row) => ({
      role: row.role as OrgMembership["role"],
      organization: row.organizations,
    }))

  return (
    <DashboardShell
      user={user}
      profile={profile}
      workspace={{
        ownerType: workspace?.ownerType ?? "user",
        orgRole: workspace?.orgRole ?? null,
        plan: workspace?.plan ?? "free",
      }}
      currentOrgId={workspace?.orgId ?? null}
      memberships={memberships}
    >
      {children}
    </DashboardShell>
  )
}
