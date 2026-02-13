import { ApiKeySection } from "@/components/dashboard/ApiKeySection"

export const metadata = {
  title: "API Keys",
}

export default function ApiKeysPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create and manage API keys for your apps and agent tools.
        </p>
      </div>

      <ApiKeySection />
    </div>
  )
}
