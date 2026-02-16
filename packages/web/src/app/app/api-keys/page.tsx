import React from "react"
import Link from "next/link"
import { ApiKeySection } from "@/components/dashboard/ApiKeySection"

export const metadata = {
  title: "API Keys",
}

export default function ApiKeysPage(): React.JSX.Element {
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

      <ApiKeySection />
    </div>
  )
}
