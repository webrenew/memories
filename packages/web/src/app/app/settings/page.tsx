import React from "react"
import { createClient } from "@/lib/supabase/server"
import { SettingsForm } from "./settings-form"

export const metadata = {
  title: "Settings",
}

export default async function SettingsPage(): Promise<React.JSX.Element | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const [profileResult, membershipsResult] = await Promise.all([
    supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single(),
    supabase
      .from("org_members")
      .select("role, organizations(id, name, slug)")
      .eq("user_id", user.id),
  ])

  const profile = profileResult.data
  const organizations = (membershipsResult.data ?? [])
    .filter(
      (row): row is typeof row & { organizations: { id: string; name: string; slug: string } } =>
        row.organizations !== null &&
        typeof row.organizations === "object" &&
        !Array.isArray(row.organizations)
    )
    .map((row) => ({
      id: row.organizations.id,
      name: row.organizations.name,
      slug: row.organizations.slug,
      role: row.role as "owner" | "admin" | "member",
    }))

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your profile
        </p>
      </div>

      <SettingsForm
        profile={{
          name: profile?.name ?? "",
          email: profile?.email ?? user.email ?? "",
          avatar_url: profile?.avatar_url ?? "",
          plan: profile?.plan ?? "free",
          embedding_model: profile?.embedding_model ?? null,
          repo_workspace_routing_mode: profile?.repo_workspace_routing_mode ?? "auto",
          repo_owner_org_mappings: Array.isArray(profile?.repo_owner_org_mappings)
            ? profile.repo_owner_org_mappings
                .filter(
                  (
                    mapping: unknown
                  ): mapping is { owner: string; org_id: string } =>
                    mapping !== null &&
                    typeof mapping === "object" &&
                    "owner" in mapping &&
                    typeof (mapping as { owner?: unknown }).owner === "string" &&
                    "org_id" in mapping &&
                    typeof (mapping as { org_id?: unknown }).org_id === "string"
                )
            : [],
          organizations,
          auth_providers: (user.identities || [])
            .map((identity) => identity.provider)
            .filter((provider): provider is string => Boolean(provider)),
        }}
      />
    </div>
  )
}
