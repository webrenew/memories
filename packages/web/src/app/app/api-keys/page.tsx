import React from "react"
import Link from "next/link"
import { ApiKeySection } from "@/components/dashboard/ApiKeySection"
import { createClient } from "@/lib/supabase/server"
import { resolveWorkspaceContext } from "@/lib/workspace"

export const metadata = {
  title: "API Keys",
}

export default async function ApiKeysPage(): Promise<React.JSX.Element> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const workspace = user ? await resolveWorkspaceContext(supabase, user.id) : null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Generate and rotate `mem_` keys for hosted MCP clients and SDK runtime calls.
        </p>
        <p className="text-xs text-muted-foreground mt-2 max-w-3xl">
          Need tenant routing and project database mappings? Use{" "}
          <Link href="/app/sdk-projects" className="text-primary hover:text-primary/80">
            AI SDK Projects
          </Link>
          .
        </p>
      </div>

      <ApiKeySection workspacePlan={workspace?.plan ?? "free"} />
    </div>
  )
}
