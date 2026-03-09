"use client"

import React, { useState } from "react"
import type { WorkspacePlan } from "@/lib/workspace"
import { ApiKeySection } from "@/components/dashboard/ApiKeySection"
import { SdkProjectsSection } from "@/components/dashboard/SdkProjectsSection"

interface SdkProjectsDashboardProps {
  workspacePlan: WorkspacePlan
  canCreateProjects: boolean
}

export function SdkProjectsDashboard({
  workspacePlan,
  canCreateProjects,
}: SdkProjectsDashboardProps): React.JSX.Element {
  const [apiKeyRefreshNonce, setApiKeyRefreshNonce] = useState(0)

  return (
    <div className="space-y-8">
      <SdkProjectsSection
        canCreateProjects={canCreateProjects}
        workspacePlan={workspacePlan}
        onApiKeyCreated={() => setApiKeyRefreshNonce((current) => current + 1)}
      />
      <ApiKeySection workspacePlan={workspacePlan} refreshNonce={apiKeyRefreshNonce} />
    </div>
  )
}
