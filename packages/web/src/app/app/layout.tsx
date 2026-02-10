import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/dashboard/DashboardShell"
import { resolveWorkspaceContext } from "@/lib/workspace"

export const metadata = {
  title: "Dashboard",
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const workspace = await resolveWorkspaceContext(supabase, user.id)

  const { data: profile } = await supabase
    .from("users")
    .select("id, email, name, avatar_url")
    .eq("id", user.id)
    .single()

  return (
    <DashboardShell
      user={user}
      profile={profile}
      workspace={{
        ownerType: workspace?.ownerType ?? "user",
        orgRole: workspace?.orgRole ?? null,
        plan: workspace?.plan ?? "free",
      }}
    >
      {children}
    </DashboardShell>
  )
}
