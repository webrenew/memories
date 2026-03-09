"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Copy, FolderKanban, KeyRound, Loader2 } from "lucide-react"
import { extractErrorMessage } from "@/lib/client-errors"
import {
  defaultExpiryInputValue,
  MIN_KEY_TTL_MS,
  toDateTimeLocalValue,
} from "@/lib/api-key-expiry"
import type { WorkspacePlan } from "@/lib/workspace"

interface SdkProjectSummary {
  id: string
  tenantId: string
  displayName: string
  description: string | null
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
  routingStatus: string | null
  routingSource: string | null
  routingUpdatedAt: string | null
}

interface CreatedApiKey {
  keyId: string
  apiKey: string
  keyPreview: string | null
  createdAt: string
  expiresAt: string
}

interface SdkProjectsResponse {
  projects?: SdkProjectSummary[]
}

interface CreateProjectResponse {
  project?: SdkProjectSummary
  apiKey?: CreatedApiKey | null
}

interface SdkProjectsSectionProps {
  canCreateProjects: boolean
  workspacePlan: WorkspacePlan
  onApiKeyCreated?: () => void
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not set"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Not set"
  return parsed.toLocaleString()
}

function routingBadge(project: SdkProjectSummary): { label: string; className: string; helper: string } {
  if (!project.routingStatus) {
    return {
      label: "Ready to activate",
      className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
      helper: "No tenant DB yet. The first scoped SDK request will create or resolve routing.",
    }
  }

  if (project.routingStatus === "ready" && project.routingSource === "auto") {
    return {
      label: "Auto routed",
      className: "border-green-500/30 bg-green-500/10 text-green-300",
      helper: "Runtime has already provisioned or resolved this tenant automatically.",
    }
  }

  if (project.routingStatus === "ready" && project.routingSource === "override") {
    return {
      label: "Override attached",
      className: "border-violet-500/30 bg-violet-500/10 text-violet-300",
      helper: "This tenant uses an explicit database override instead of automatic routing.",
    }
  }

  if (project.routingStatus === "provisioning") {
    return {
      label: "Provisioning",
      className: "border-blue-500/30 bg-blue-500/10 text-blue-300",
      helper: "A tenant database is being provisioned.",
    }
  }

  if (project.routingStatus === "error") {
    return {
      label: "Provision error",
      className: "border-red-500/30 bg-red-500/10 text-red-300",
      helper: "The last tenant database provisioning attempt failed.",
    }
  }

  return {
    label: "Disabled",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    helper: "This tenant override is currently disabled.",
  }
}

export function SdkProjectsSection({
  canCreateProjects,
  workspacePlan,
  onApiKeyCreated,
}: SdkProjectsSectionProps): React.JSX.Element {
  const [projects, setProjects] = useState<SdkProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [tenantId, setTenantId] = useState("")
  const [description, setDescription] = useState("")
  const [generateApiKey, setGenerateApiKey] = useState(false)
  const [expiryInput, setExpiryInput] = useState(defaultExpiryInputValue())
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const minExpiryValue = useMemo(
    () => toDateTimeLocalValue(new Date(Date.now() + MIN_KEY_TTL_MS)),
    []
  )
  const canSubmit =
    canCreateProjects &&
    workspacePlan !== "past_due" &&
    !saving &&
    displayName.trim().length > 0 &&
    tenantId.trim().length > 0

  const fetchProjects = useCallback(async () => {
    try {
      setError(null)
      const response = await fetch("/api/sdk-projects")
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Failed to load AI SDK projects (HTTP ${response.status})`))
      }

      const data = (payload ?? {}) as SdkProjectsResponse
      setProjects(Array.isArray(data.projects) ? data.projects : [])
    } catch (err) {
      console.error("Failed to load AI SDK projects:", err)
      setError(err instanceof Error ? err.message : "Failed to load AI SDK projects")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  const handleCreateProject = useCallback(async () => {
    setSaving(true)
    setStatusMessage(null)
    setCreatedKey(null)
    setCopiedKey(false)
    try {
      const parsedExpiry = generateApiKey ? new Date(expiryInput) : null
      if (generateApiKey && (!parsedExpiry || Number.isNaN(parsedExpiry.getTime()))) {
        throw new Error("Expiry must be a valid date and time.")
      }
      const expiresAt = parsedExpiry ? parsedExpiry.toISOString() : undefined

      setError(null)
      const response = await fetch("/api/sdk-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          tenantId,
          description,
          generateApiKey,
          expiresAt,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Failed to create AI SDK project (HTTP ${response.status})`))
      }

      const data = (payload ?? {}) as CreateProjectResponse
      if (data.project) {
        setProjects((current) => [data.project as SdkProjectSummary, ...current.filter((item) => item.id !== data.project?.id)])
        setStatusMessage(`Created AI SDK project "${data.project.displayName}".`)
      }
      if (data.apiKey?.apiKey) {
        setCreatedKey(data.apiKey)
        onApiKeyCreated?.()
      }

      setDisplayName("")
      setTenantId("")
      setDescription("")
      setGenerateApiKey(false)
      setExpiryInput(defaultExpiryInputValue())
    } catch (err) {
      console.error("Failed to create AI SDK project:", err)
      setError(err instanceof Error ? err.message : "Failed to create AI SDK project")
    } finally {
      setSaving(false)
    }
  }, [description, displayName, expiryInput, generateApiKey, onApiKeyCreated, tenantId])

  const copyGeneratedKey = useCallback(async () => {
    if (!createdKey?.apiKey) return
    try {
      await navigator.clipboard.writeText(createdKey.apiKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    } catch (err) {
      console.error("Failed to copy generated SDK API key:", err)
      setError("Failed to copy API key")
    }
  }, [createdKey])

  return (
    <div className="border border-border bg-card/20 rounded-lg">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">AI SDK Projects</h3>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Register customer or environment `tenantId` values up front so the team has a stable project list before first runtime traffic.
        </p>
      </div>

      <div className="p-4 space-y-5">
        {workspacePlan === "past_due" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Billing is past due. Update payment details before creating new AI SDK projects.
          </div>
        )}

        {!canCreateProjects && workspacePlan !== "past_due" && (
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            Creating shared AI SDK projects requires an owner or admin role in the current workspace.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Project Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Acme Production"
                  disabled={saving || !canCreateProjects || workspacePlan === "past_due"}
                  className="w-full bg-muted/30 px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50 disabled:opacity-60"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Tenant ID (`tenantId`)</label>
                <input
                  type="text"
                  value={tenantId}
                  onChange={(event) => setTenantId(event.target.value)}
                  placeholder="acme-prod"
                  disabled={saving || !canCreateProjects || workspacePlan === "past_due"}
                  className="w-full bg-muted/30 px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50 disabled:opacity-60"
                />
                <p className="text-xs text-muted-foreground">
                  This is the security and database boundary your backend should send in SDK calls.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Description (optional)</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                placeholder="Production customer workspace for Acme Inc."
                disabled={saving || !canCreateProjects || workspacePlan === "past_due"}
                className="w-full bg-muted/30 px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50 disabled:opacity-60"
              />
            </div>

            <div className="rounded-md border border-border bg-muted/15 p-3 space-y-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={generateApiKey}
                  onChange={(event) => setGenerateApiKey(event.target.checked)}
                  disabled={saving || !canCreateProjects || workspacePlan === "past_due"}
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Generate a new API key during setup</span>
                  <span className="block text-xs text-muted-foreground">
                    Optional. Turn this on when the app or environment needs a fresh `mem_` key now. Leave it off if you want to reuse an existing key.
                  </span>
                </span>
              </label>

              {generateApiKey && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Key Expiry</label>
                  <input
                    type="datetime-local"
                    value={expiryInput}
                    min={minExpiryValue}
                    onChange={(event) => setExpiryInput(event.target.value)}
                    disabled={saving || !canCreateProjects || workspacePlan === "past_due"}
                    className="w-full bg-background/70 px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50 disabled:opacity-60"
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleCreateProject()}
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderKanban className="h-4 w-4" />}
              Create Project
            </button>
          </div>

          <div className="rounded-md border border-border bg-muted/15 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">What happens when you create one?</p>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>The project is saved in the current dashboard workspace.</li>
              <li>You get a reusable `tenantId` record before sending traffic.</li>
              <li>Runtime routing still happens on first SDK request, unless you attach an override manually.</li>
              <li>If you choose key creation, the full `mem_` key is shown once right after submit.</li>
            </ul>
          </div>
        </div>

        {statusMessage && (
          <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-200">
            {statusMessage}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {createdKey && (
          <div className="rounded-md border border-primary/30 bg-primary/10 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">New API key created</p>
                <p className="text-xs text-muted-foreground">
                  Save this now. Only the hashed preview is stored after this step.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void copyGeneratedKey()}
                className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-background/40"
              >
                {copiedKey ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                Copy key
              </button>
            </div>
            <code className="block overflow-x-auto rounded bg-background/60 px-3 py-2 text-xs font-mono">
              {createdKey.apiKey}
            </code>
            <p className="text-xs text-muted-foreground">
              Created {formatDateTime(createdKey.createdAt)} · Expires {formatDateTime(createdKey.expiresAt)}
            </p>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Workspace project registry</p>
            <p className="text-xs text-muted-foreground">{projects.length} total</p>
          </div>

          {loading ? (
            <div className="animate-pulse h-24 rounded bg-muted/20" />
          ) : projects.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
              No AI SDK projects yet. Create one above to reserve a `tenantId` before wiring your backend.
            </div>
          ) : (
            <div className="grid gap-3">
              {projects.map((project) => {
                const badge = routingBadge(project)
                return (
                  <div key={project.id} className="rounded-md border border-border bg-muted/10 p-4 space-y-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1 min-w-0">
                        <p className="font-medium truncate">{project.displayName}</p>
                        <p className="text-xs font-mono text-primary break-all">{project.tenantId}</p>
                        {project.description && (
                          <p className="text-sm text-muted-foreground">{project.description}</p>
                        )}
                      </div>
                      <div className={`inline-flex self-start rounded-full border px-2 py-1 text-[11px] font-medium ${badge.className}`}>
                        {badge.label}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">{badge.helper}</p>

                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                      <div>
                        <span className="block uppercase tracking-wider mb-1">Created</span>
                        <span>{formatDateTime(project.createdAt)}</span>
                      </div>
                      <div>
                        <span className="block uppercase tracking-wider mb-1">Last change</span>
                        <span>{formatDateTime(project.routingUpdatedAt ?? project.updatedAt)}</span>
                      </div>
                      <div>
                        <span className="block uppercase tracking-wider mb-1">Routing source</span>
                        <span>{project.routingSource ?? "Not activated yet"}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
