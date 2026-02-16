"use client"

import React, { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ChevronDown } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { UserIdentity } from "@supabase/supabase-js"

// Match CLI embedding models
const EMBEDDING_MODELS = [
  {
    id: "all-MiniLM-L6-v2",
    name: "MiniLM L6 v2",
    dimensions: 384,
    description: "Fastest model, good for most use cases",
    speed: "fast",
    quality: "good",
  },
  {
    id: "gte-small",
    name: "GTE Small",
    dimensions: 384,
    description: "Small GTE model, fast with good quality",
    speed: "fast",
    quality: "good",
  },
  {
    id: "gte-base",
    name: "GTE Base",
    dimensions: 768,
    description: "Balanced speed and quality",
    speed: "medium",
    quality: "better",
  },
  {
    id: "gte-large",
    name: "GTE Large",
    dimensions: 1024,
    description: "Highest quality, slower",
    speed: "slow",
    quality: "best",
  },
  {
    id: "mxbai-embed-large-v1",
    name: "MixedBread Large",
    dimensions: 1024,
    description: "High quality mixedbread model",
    speed: "slow",
    quality: "best",
  },
] as const

type SpeedLabel = "fast" | "medium" | "slow"
type QualityLabel = "good" | "better" | "best"

const SPEED_COLORS: Record<SpeedLabel, string> = {
  fast: "text-green-400",
  medium: "text-amber-400",
  slow: "text-red-400",
}

const QUALITY_COLORS: Record<QualityLabel, string> = {
  good: "text-blue-400",
  better: "text-purple-400",
  best: "text-primary",
}

interface SettingsFormProps {
  profile: {
    name: string
    email: string
    avatar_url: string
    plan: string
    embedding_model: string | null
    repo_workspace_routing_mode: RepoWorkspaceRoutingMode
    repo_owner_org_mappings: RepoOwnerOrgMapping[]
    organizations: OrgRoutingOption[]
    auth_providers: string[]
  }
}

type OAuthProvider = "github" | "google"
type RepoWorkspaceRoutingMode = "auto" | "active_workspace"
type RepoOwnerOrgMapping = { owner: string; org_id: string }
type OrgRoutingOption = {
  id: string
  name: string
  slug: string
  role: "owner" | "admin" | "member"
}

const OAUTH_PROVIDERS: Array<{ id: OAuthProvider; label: string; scopes: string }> = [
  { id: "github", label: "GitHub", scopes: "read:user user:email" },
  { id: "google", label: "Google", scopes: "openid profile email" },
]

const PAID_USER_PLANS = new Set(["individual", "pro", "team", "growth", "enterprise"])

function normalizeOwnerInput(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase()
}

function serializeRepoOwnerOrgMappings(mappings: RepoOwnerOrgMapping[]): string {
  return JSON.stringify(
    mappings.map((mapping) => ({
      owner: normalizeOwnerInput(mapping.owner),
      org_id: mapping.org_id.trim(),
    }))
  )
}

export function SettingsForm({ profile }: SettingsFormProps): React.JSX.Element {
  const [supabase] = useState(() => createClient())
  const [name, setName] = useState(profile.name)
  const [embeddingModel, setEmbeddingModel] = useState(
    profile.embedding_model || "all-MiniLM-L6-v2"
  )
  const [repoRoutingMode, setRepoRoutingMode] = useState<RepoWorkspaceRoutingMode>(
    profile.repo_workspace_routing_mode
  )
  const [repoOwnerMappings, setRepoOwnerMappings] = useState<RepoOwnerOrgMapping[]>(
    profile.repo_owner_org_mappings ?? []
  )
  const [saving, setSaving] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showDimensionWarning, setShowDimensionWarning] = useState(false)
  const [identities, setIdentities] = useState<UserIdentity[]>([])
  const [authLoading, setAuthLoading] = useState(false)
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null)
  const [unlinkingProvider, setUnlinkingProvider] = useState<OAuthProvider | null>(null)

  const currentModel = EMBEDDING_MODELS.find((m) => m.id === embeddingModel)
  const originalModel = EMBEDDING_MODELS.find(
    (m) => m.id === (profile.embedding_model || "all-MiniLM-L6-v2")
  )
  const hasPaidPlan = PAID_USER_PLANS.has((profile.plan || "").toLowerCase())
  const hasOrganizations = profile.organizations.length > 0
  const canConfigureOrgMappings = hasPaidPlan && hasOrganizations

  function handleModelSelect(modelId: string) {
    const newModel = EMBEDDING_MODELS.find((m) => m.id === modelId)
    const oldModel = EMBEDDING_MODELS.find(
      (m) => m.id === (profile.embedding_model || "all-MiniLM-L6-v2")
    )

    // Check if dimensions are different
    if (newModel && oldModel && newModel.dimensions !== oldModel.dimensions) {
      setShowDimensionWarning(true)
    } else {
      setShowDimensionWarning(false)
    }

    setEmbeddingModel(modelId)
    setShowModelDropdown(false)
  }

  async function handleSave() {
    const normalizedMappings = repoOwnerMappings.map((mapping) => ({
      owner: normalizeOwnerInput(mapping.owner),
      org_id: mapping.org_id.trim(),
    }))
    const hasIncompleteMapping = normalizedMappings.some((mapping) => {
      const ownerFilled = mapping.owner.length > 0
      const orgFilled = mapping.org_id.length > 0
      return ownerFilled !== orgFilled
    })

    if (hasIncompleteMapping) {
      toast.error("Fill out both owner and workspace for each mapping, or remove the row")
      return
    }

    const filteredMappings = normalizedMappings.filter(
      (mapping) => mapping.owner.length > 0 && mapping.org_id.length > 0
    )
    const duplicateOwner = (() => {
      const seen = new Set<string>()
      for (const mapping of filteredMappings) {
        if (seen.has(mapping.owner)) {
          return mapping.owner
        }
        seen.add(mapping.owner)
      }
      return null
    })()

    if (duplicateOwner) {
      toast.error(`Owner "${duplicateOwner}" is already mapped`)
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          embedding_model: embeddingModel,
          repo_workspace_routing_mode: repoRoutingMode,
          repo_owner_org_mappings: filteredMappings,
        }),
      })

      if (!res.ok) {
        throw new Error("Failed to save")
      }

      // Reset warning since it's now saved
      setShowDimensionWarning(false)
      toast.success("Settings saved")
    } catch (error) {
      console.error("Settings save error:", error)
      toast.error("Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    name !== profile.name ||
    embeddingModel !== (profile.embedding_model || "all-MiniLM-L6-v2") ||
    repoRoutingMode !== profile.repo_workspace_routing_mode ||
    serializeRepoOwnerOrgMappings(repoOwnerMappings) !==
      serializeRepoOwnerOrgMappings(profile.repo_owner_org_mappings ?? [])

  function handleAddRepoOwnerMapping() {
    setRepoOwnerMappings((current) => [
      ...current,
      { owner: "", org_id: profile.organizations[0]?.id ?? "" },
    ])
  }

  function handleRepoOwnerMappingChange(
    index: number,
    key: keyof RepoOwnerOrgMapping,
    value: string
  ) {
    setRepoOwnerMappings((current) =>
      current.map((mapping, mappingIndex) =>
        mappingIndex === index ? { ...mapping, [key]: value } : mapping
      )
    )
  }

  function handleRemoveRepoOwnerMapping(index: number) {
    setRepoOwnerMappings((current) => current.filter((_, mappingIndex) => mappingIndex !== index))
  }

  const effectiveProviders = (identities.length > 0
    ? identities.map((identity) => identity.provider)
    : profile.auth_providers
  ).filter((provider): provider is OAuthProvider => provider === "github" || provider === "google")

  const linkedProviders = new Set(effectiveProviders)
  const linkedIdentityCount = effectiveProviders.length

  const refreshIdentities = useCallback(async () => {
    setAuthLoading(true)
    try {
      const { data, error } = await supabase.auth.getUser()
      if (error) {
        throw error
      }

      const userIdentities = (data.user?.identities || []) as UserIdentity[]
      setIdentities(userIdentities)
    } catch (error) {
      console.error("Failed to refresh auth identities:", error)
      toast.error("Failed to refresh connected accounts")
    } finally {
      setAuthLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    void refreshIdentities()
  }, [refreshIdentities])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const linked = params.get("linked")
    if (linked === "github" || linked === "google") {
      const providerLabel = linked === "github" ? "GitHub" : "Google"
      toast.success(`${providerLabel} account linked`)

      params.delete("linked")
      const nextQuery = params.toString()
      const nextUrl = nextQuery
        ? `${window.location.pathname}?${nextQuery}`
        : window.location.pathname
      window.history.replaceState({}, "", nextUrl)
      void refreshIdentities()
    }
  }, [refreshIdentities])

  async function handleLinkProvider(provider: OAuthProvider) {
    setLinkingProvider(provider)
    try {
      const target = `/app/settings?linked=${provider}`
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`
      const scopes = OAUTH_PROVIDERS.find((entry) => entry.id === provider)?.scopes
      const { error } = await supabase.auth.linkIdentity({
        provider,
        options: {
          redirectTo,
          scopes,
        },
      })

      if (error) {
        throw error
      }
    } catch (error) {
      console.error("Failed to link identity:", error)
      toast.error(error instanceof Error ? error.message : "Failed to connect provider")
      setLinkingProvider(null)
    }
  }

  async function handleUnlinkProvider(provider: OAuthProvider) {
    if (linkedIdentityCount <= 1) {
      toast.error("Connect another provider before unlinking your last sign-in method")
      return
    }

    const identity = identities.find((entry) => entry.provider === provider)
    if (!identity) {
      toast.error("Provider is not linked")
      return
    }

    if (!confirm(`Disconnect ${provider === "github" ? "GitHub" : "Google"} from this account?`)) {
      return
    }

    setUnlinkingProvider(provider)
    try {
      const { error } = await supabase.auth.unlinkIdentity(identity)
      if (error) {
        throw error
      }

      toast.success(`${provider === "github" ? "GitHub" : "Google"} disconnected`)
      await refreshIdentities()
    } catch (error) {
      console.error("Failed to unlink identity:", error)
      toast.error(error instanceof Error ? error.message : "Failed to disconnect provider")
    } finally {
      setUnlinkingProvider(null)
    }
  }

  return (
    <div className="space-y-8 max-w-xl">
      {/* Profile section */}
      <div className="border border-border bg-card/20 p-6 space-y-6">
        <h2 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60">
          Profile
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 bg-background border border-border text-sm focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2">
              Email
            </label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full px-4 py-3 bg-muted/30 border border-border text-sm text-muted-foreground"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2">
              Plan
            </label>
            <div className="px-4 py-3 bg-muted/30 border border-border text-sm">
              <span className="uppercase tracking-wider font-bold">{profile.plan}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Embedding Model section */}
      <div className="border border-border bg-card/20 p-6 space-y-6">
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60">
            Embedding Model
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            The model used to generate semantic embeddings for your memories
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowModelDropdown(!showModelDropdown)}
            className="w-full px-4 py-3 bg-background border border-border text-sm focus:border-primary/50 focus:outline-none transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="font-medium">{currentModel?.name || embeddingModel}</span>
              <span className="text-xs text-muted-foreground">
                {currentModel?.dimensions}d
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </button>

          {showModelDropdown && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowModelDropdown(false)}
              />
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border shadow-lg z-20 max-h-[300px] overflow-y-auto">
                {EMBEDDING_MODELS.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => handleModelSelect(model.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors ${
                      embeddingModel === model.id ? "bg-muted/30" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{model.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] uppercase ${SPEED_COLORS[model.speed]}`}>
                          {model.speed}
                        </span>
                        <span className={`text-[10px] uppercase ${QUALITY_COLORS[model.quality]}`}>
                          {model.quality}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {model.dimensions}d
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {model.description}
                    </p>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Dimension change warning */}
        {showDimensionWarning && originalModel && currentModel && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-sm">
            <p className="text-amber-400 font-medium mb-1">Dimension Change Warning</p>
            <p className="text-muted-foreground text-xs">
              Switching from {originalModel.dimensions}d to {currentModel.dimensions}d will
              require re-embedding your existing memories. Run{" "}
              <code className="px-1 py-0.5 bg-muted text-foreground">memories embed --all</code>{" "}
              after saving to regenerate embeddings.
            </p>
          </div>
        )}

        {/* Model info */}
        {currentModel && (
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 bg-muted/30 border border-border">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Speed
              </p>
              <p className={`text-sm font-bold uppercase ${SPEED_COLORS[currentModel.speed]}`}>
                {currentModel.speed}
              </p>
            </div>
            <div className="p-3 bg-muted/30 border border-border">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Quality
              </p>
              <p className={`text-sm font-bold uppercase ${QUALITY_COLORS[currentModel.quality]}`}>
                {currentModel.quality}
              </p>
            </div>
            <div className="p-3 bg-muted/30 border border-border">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Dimensions
              </p>
              <p className="text-sm font-bold font-mono">{currentModel.dimensions}</p>
            </div>
          </div>
        )}
      </div>

      <div className="border border-border bg-card/20 p-6 space-y-6">
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60">
            Repo Workspace Routing
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Default mode routes GitHub org repos to org memory and personal repos to personal memory.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setRepoRoutingMode("auto")}
            className={`text-left border px-4 py-3 transition-colors ${
              repoRoutingMode === "auto"
                ? "border-primary bg-primary/10"
                : "border-border bg-muted/20 hover:bg-muted/30"
            }`}
          >
            <p className="text-xs font-bold uppercase tracking-[0.1em]">Auto (Default)</p>
            <p className="text-xs text-muted-foreground mt-1">
              Org repo owner maps to org workspace; everything else maps to personal workspace.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setRepoRoutingMode("active_workspace")}
            className={`text-left border px-4 py-3 transition-colors ${
              repoRoutingMode === "active_workspace"
                ? "border-primary bg-primary/10"
                : "border-border bg-muted/20 hover:bg-muted/30"
            }`}
          >
            <p className="text-xs font-bold uppercase tracking-[0.1em]">Use Active Workspace</p>
            <p className="text-xs text-muted-foreground mt-1">
              Always route to your currently selected workspace, ignoring repo owner.
            </p>
          </button>
        </div>

        <div className="border-t border-border/70 pt-4 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.1em]">Org Owner Mappings</p>
            <p className="text-xs text-muted-foreground mt-1">
              Map GitHub owners to one of your org workspaces when auto routing is enabled.
            </p>
          </div>

          {!hasOrganizations && (
            <p className="text-xs text-muted-foreground">
              Join an organization to add owner mappings.
            </p>
          )}

          {hasOrganizations && !canConfigureOrgMappings && (
            <p className="text-xs text-muted-foreground">
              Owner mappings are available on paid plans. Upgrade on{" "}
              <a href="/app/upgrade" className="text-primary underline underline-offset-4">
                Billing
              </a>{" "}
              to unlock this control.
            </p>
          )}

          {canConfigureOrgMappings && (
            <div className="space-y-3">
              {repoOwnerMappings.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No mappings yet. Add one to route org-owned repos that don&apos;t match your org slug.
                </p>
              )}

              {repoOwnerMappings.map((mapping, index) => (
                <div
                  key={`${mapping.owner}-${mapping.org_id}-${index}`}
                  className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-center"
                >
                  <input
                    type="text"
                    value={mapping.owner}
                    onChange={(event) =>
                      handleRepoOwnerMappingChange(index, "owner", event.target.value)
                    }
                    placeholder="GitHub owner (for example: acme)"
                    className="w-full px-3 py-2 bg-background border border-border text-xs focus:border-primary/50 focus:outline-none transition-colors"
                  />

                  <select
                    value={mapping.org_id}
                    onChange={(event) =>
                      handleRepoOwnerMappingChange(index, "org_id", event.target.value)
                    }
                    className="w-full px-3 py-2 bg-background border border-border text-xs focus:border-primary/50 focus:outline-none transition-colors"
                  >
                    <option value="">Select workspace</option>
                    {profile.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name} ({organization.slug})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleRemoveRepoOwnerMapping(index)}
                    className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] border border-border bg-background hover:bg-muted/30 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={handleAddRepoOwnerMapping}
                className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Add Owner Mapping
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Connected Accounts */}
      <div className="border border-border bg-card/20 p-6 space-y-6">
        <div>
          <h2 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60">
            Connected Accounts
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Link multiple sign-in providers so GitHub and Google always open the same account.
          </p>
        </div>

        <div className="space-y-3">
          {OAUTH_PROVIDERS.map((provider) => {
            const isLinked = linkedProviders.has(provider.id)
            const isBusy = linkingProvider === provider.id || unlinkingProvider === provider.id

            return (
              <div
                key={provider.id}
                className="flex items-center justify-between gap-4 border border-border bg-muted/20 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{provider.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {isLinked ? "Connected" : "Not connected"}
                  </p>
                </div>

                {isLinked ? (
                  <button
                    type="button"
                    onClick={() => handleUnlinkProvider(provider.id)}
                    disabled={authLoading || isBusy}
                    className="px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] border border-border bg-background hover:bg-muted/30 transition-colors disabled:opacity-50"
                  >
                    {isBusy ? "Disconnecting..." : "Disconnect"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleLinkProvider(provider.id)}
                    disabled={authLoading || isBusy}
                    className="px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {isBusy ? "Connecting..." : "Connect"}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Keep at least two providers linked before disconnecting one to avoid lockout.
        </p>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || !hasChanges}
        className="px-8 py-3 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-[0.15em] hover:opacity-90 transition-all duration-300 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>

      {/* Sign out */}
      <div className="border-t border-border pt-8">
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="px-8 py-3 bg-muted/50 text-foreground border border-border text-xs font-bold uppercase tracking-[0.15em] hover:bg-muted transition-all duration-300"
          >
            Sign Out
          </button>
        </form>
      </div>
    </div>
  )
}
