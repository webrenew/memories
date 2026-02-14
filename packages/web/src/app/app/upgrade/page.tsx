import React from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { UpgradeCard } from "./upgrade-card"
import { resolveWorkspaceContext } from "@/lib/workspace"

export const metadata = {
  title: "Upgrade to Pro",
}

export default async function UpgradePage(): Promise<React.JSX.Element | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const workspace = await resolveWorkspaceContext(supabase, user.id)
  const canManageBilling = workspace?.canManageBilling ?? true

  if (workspace?.plan === "pro") {
    redirect("/app")
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight mb-3">
          Upgrade to Pro
        </h1>
        <p className="text-muted-foreground max-w-md leading-relaxed">
          Add cloud sync, a web dashboard, and cross-device access to your memory workflow.
        </p>
      </div>

      {!canManageBilling ? (
        <div className="max-w-md border border-amber-500/30 bg-amber-500/5 p-5 text-sm">
          <p className="font-medium text-amber-300">Billing is owner-managed</p>
          <p className="text-amber-200/80 mt-1">
            Only the organization owner can start checkout while an organization workspace is active.
          </p>
        </div>
      ) : (
        <UpgradeCard />
      )}
    </div>
  )
}
