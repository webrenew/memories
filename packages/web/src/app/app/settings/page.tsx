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

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single()

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
          auth_providers: (user.identities || [])
            .map((identity) => identity.provider)
            .filter((provider): provider is string => Boolean(provider)),
        }}
      />
    </div>
  )
}
