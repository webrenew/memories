import React from "react"
import Link from "next/link"
import { ApiKeySection } from "@/components/dashboard/ApiKeySection"

export const metadata = {
  title: "AI SDK Projects",
}

const scopeCards = [
  {
    title: "AI SDK Project",
    token: "tenantId",
    detail:
      "Primary SaaS isolation boundary. Use one project id per customer workspace, environment, or app surface.",
  },
  {
    title: "End User",
    token: "userId",
    detail:
      "End-user scope inside tenantId. Use this when each customer user should have their own memory stream.",
  },
  {
    title: "Repo Filter (Optional)",
    token: "projectId",
    detail:
      "Optional git/repository context filter. Helpful for coding copilots, and not required for non-git SaaS flows.",
  },
]

export default function SdkProjectsPage(): React.JSX.Element {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI SDK Projects</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          The entry point for SaaS integrations. Create API keys, provision project databases, and map the right
          scope model for your app.
        </p>
        <p className="text-xs text-muted-foreground mt-2 max-w-3xl">
          If your app only uses SDK endpoints (`/api/sdk/v1/*`), you do not need MCP multitenancy.
          Use MCP routing only when you are serving MCP clients.
        </p>
      </div>

      <div className="border border-border bg-card/20 rounded-lg p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.15em] font-bold text-muted-foreground">Workspace ownership</p>
          <p className="text-sm text-muted-foreground">
            Projects created here belong to the currently selected dashboard workspace. Solo devs can stay in their
            personal workspace. Teams can switch workspace from the top-left workspace switcher.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {scopeCards.map((card) => (
            <div key={card.token} className="border border-border rounded-md bg-muted/15 p-3 space-y-2">
              <p className="text-xs uppercase tracking-[0.12em] font-semibold text-muted-foreground">{card.title}</p>
              <p className="text-sm font-mono text-primary">{card.token}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{card.detail}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Need implementation details? Read the{" "}
          <Link href="/docs/sdk/projects" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
            AI SDK Projects guide
          </Link>{" "}
          and{" "}
          <Link
            href="/docs/sdk/saas-auth-routing"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary/80"
          >
            SaaS auth routing
          </Link>
          .
        </p>
      </div>

      <ApiKeySection />
    </div>
  )
}
