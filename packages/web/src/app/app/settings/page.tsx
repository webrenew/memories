import { createClient } from "@/lib/supabase/server"
import { SettingsForm } from "./settings-form"

export const metadata = {
  title: "Settings",
}

export default async function SettingsPage() {
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
        }}
      />
    </div>
  )
}
