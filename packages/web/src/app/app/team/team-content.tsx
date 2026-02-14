"use client"

import React, { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { 
  Users, 
  Plus, 
  Crown, 
  Shield, 
  User, 
  Mail,
  Trash2,
  Check,
} from "lucide-react"
import { InviteModal } from "./invite-modal"
import { MemoryMigrationCard } from "./memory-migration-card"

interface Organization {
  id: string
  name: string
  slug: string
  owner_id: string
  plan: string
  created_at: string
  role: string
  domain_auto_join_enabled?: boolean | null
  domain_auto_join_domain?: string | null
}

interface OrganizationDetails {
  id: string
  domain_auto_join_enabled?: boolean | null
  domain_auto_join_domain?: string | null
  updated_at?: string | null
}

interface GithubCaptureSettings {
  allowed_events: Array<"pull_request" | "issues" | "push" | "release">
  repo_allow_list: string[]
  repo_block_list: string[]
  branch_filters: string[]
  label_filters: string[]
  actor_filters: string[]
  include_prerelease: boolean
}

interface Member {
  id: string
  role: string
  joined_at: string | null
  last_login_at: string | null
  memory_count: number
  user_memory_count: number
  user: {
    id: string
    email: string
    name: string | null
    avatar_url: string | null
  }
}

interface Invite {
  id: string
  email: string
  role: string
  created_at: string
  expires_at: string
  inviter: {
    name: string | null
    email: string
  }
}

interface AuditEvent {
  id: string
  action: string
  target_type: string | null
  target_id: string | null
  target_label: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  actor_user_id: string | null
  actor: {
    id: string
    email: string | null
    name: string | null
  } | null
}

function roleIcon(role: string) {
  switch (role) {
    case "owner": return <Crown className="h-3 w-3 text-amber-400" />
    case "admin": return <Shield className="h-3 w-3 text-blue-400" />
    default: return <User className="h-3 w-3 text-muted-foreground" />
  }
}

function formatLastLogin(lastLoginAt: string | null): string {
  if (!lastLoginAt) return "Never"
  const date = new Date(lastLoginAt)
  if (Number.isNaN(date.getTime())) return "Unknown"
  return date.toLocaleString()
}

function formatAuditAction(action: string): string {
  return action
    .split("_")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ")
}

function summarizeAuditMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!metadata || typeof metadata !== "object") return null

  const keys = [
    "role",
    "previousRole",
    "nextRole",
    "removedBySelf",
    "domain_auto_join_enabled",
    "domain_auto_join_domain",
  ]

  const parts: string[] = []
  for (const key of keys) {
    if (!(key in metadata)) continue
    const value = metadata[key]
    if (value === null || value === undefined) continue
    parts.push(`${key}=${String(value)}`)
  }

  return parts.length > 0 ? parts.join(" • ") : null
}

function formatListField(values: string[] | null | undefined): string {
  if (!Array.isArray(values) || values.length === 0) return ""
  return values.join("\n")
}

function parseListField(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  )
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false

  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()

  return leftSorted.every((value, index) => value === rightSorted[index])
}

export function TeamContent({ 
  organizations, 
  currentOrgId,
  userId 
}: { 
  organizations: Organization[]
  currentOrgId: string | null
  userId: string
}): React.JSX.Element {
  const router = useRouter()
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(() => {
    if (!currentOrgId) return null
    return organizations.some((org) => org.id === currentOrgId) ? currentOrgId : null
  })
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [auditError, setAuditError] = useState<string | null>(null)
  const [orgDetails, setOrgDetails] = useState<OrganizationDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [savingDomainSettings, setSavingDomainSettings] = useState(false)
  const [domainAutoJoinEnabled, setDomainAutoJoinEnabled] = useState(false)
  const [domainAutoJoinDomain, setDomainAutoJoinDomain] = useState("")
  const [domainSettingsError, setDomainSettingsError] = useState<string | null>(null)
  const [domainSettingsSuccess, setDomainSettingsSuccess] = useState<string | null>(null)
  const [captureSettings, setCaptureSettings] = useState<GithubCaptureSettings | null>(null)
  const [savingCaptureSettings, setSavingCaptureSettings] = useState(false)
  const [captureSettingsError, setCaptureSettingsError] = useState<string | null>(null)
  const [captureSettingsSuccess, setCaptureSettingsSuccess] = useState<string | null>(null)
  const [allowedEvents, setAllowedEvents] = useState<Array<"pull_request" | "issues" | "push" | "release">>([])
  const [includePrerelease, setIncludePrerelease] = useState(true)
  const [repoAllowListText, setRepoAllowListText] = useState("")
  const [repoBlockListText, setRepoBlockListText] = useState("")
  const [branchFiltersText, setBranchFiltersText] = useState("")
  const [labelFiltersText, setLabelFiltersText] = useState("")
  const [actorFiltersText, setActorFiltersText] = useState("")
  const [showCreateOrg, setShowCreateOrg] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newOrgName, setNewOrgName] = useState("")
  const isMountedRef = useRef(true)
  const orgDataRequestIdRef = useRef(0)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!currentOrgId) {
      setSelectedOrgId(null)
      return
    }

    const exists = organizations.some((org) => org.id === currentOrgId)
    setSelectedOrgId(exists ? currentOrgId : null)
  }, [currentOrgId, organizations])

  const selectedOrg = organizations.find(o => o.id === selectedOrgId)
  const selectedOrgRecord = orgDetails?.id === selectedOrgId && selectedOrg ? { ...selectedOrg, ...orgDetails } : selectedOrg
  const selectedOrgRecordId = selectedOrgRecord?.id
  const selectedOrgRecordDomainEnabled = selectedOrgRecord?.domain_auto_join_enabled
  const selectedOrgRecordDomain = selectedOrgRecord?.domain_auto_join_domain
  const isOwner = selectedOrg?.role === "owner"
  const isAdmin = selectedOrg?.role === "admin" || isOwner
  const parsedRepoAllowList = parseListField(repoAllowListText)
  const parsedRepoBlockList = parseListField(repoBlockListText)
  const parsedBranchFilters = parseListField(branchFiltersText)
  const parsedLabelFilters = parseListField(labelFiltersText)
  const parsedActorFilters = parseListField(actorFiltersText)
  const domainSettingsDirty =
    selectedOrgRecord !== undefined &&
    (domainAutoJoinEnabled !== Boolean(selectedOrgRecord?.domain_auto_join_enabled) ||
      domainAutoJoinDomain.trim().toLowerCase() !== (selectedOrgRecord?.domain_auto_join_domain ?? "").toLowerCase())
  const captureSettingsDirty =
    captureSettings !== null &&
    (
      !sameStringList(allowedEvents, captureSettings.allowed_events) ||
      includePrerelease !== captureSettings.include_prerelease ||
      !sameStringList(parsedRepoAllowList, captureSettings.repo_allow_list) ||
      !sameStringList(parsedRepoBlockList, captureSettings.repo_block_list) ||
      !sameStringList(parsedBranchFilters, captureSettings.branch_filters) ||
      !sameStringList(parsedLabelFilters, captureSettings.label_filters) ||
      !sameStringList(parsedActorFilters, captureSettings.actor_filters)
    )

  async function fetchOrgData(orgId: string, options?: { includeAudit?: boolean; includeCaptureSettings?: boolean }) {
    const includeAudit = options?.includeAudit ?? false
    const includeCaptureSettings = options?.includeCaptureSettings ?? false
    const requestId = ++orgDataRequestIdRef.current
    const shouldIgnore = () =>
      !isMountedRef.current || requestId !== orgDataRequestIdRef.current

    setLoading(true)
    try {
      const [membersRes, invitesRes, orgRes, captureSettingsRes] = await Promise.all([
        fetch(`/api/orgs/${orgId}/members`),
        fetch(`/api/orgs/${orgId}/invites`),
        fetch(`/api/orgs/${orgId}`),
        includeCaptureSettings
          ? fetch(`/api/orgs/${orgId}/github-capture/settings`)
          : Promise.resolve(null),
      ])

      if (shouldIgnore()) {
        return
      }

      if (membersRes.ok) {
        const data = await membersRes.json()
        if (shouldIgnore()) {
          return
        }
        setMembers(data.members || [])
      } else {
        console.error("Failed to fetch members:", membersRes.status, await membersRes.text())
      }

      if (invitesRes.ok) {
        const data = await invitesRes.json()
        if (shouldIgnore()) {
          return
        }
        setInvites(data.invites || [])
      } else {
        console.error("Failed to fetch invites:", invitesRes.status, await invitesRes.text())
      }

      if (orgRes.ok) {
        const data = await orgRes.json()
        if (shouldIgnore()) {
          return
        }
        setOrgDetails(data.organization ?? null)
      } else {
        console.error("Failed to fetch organization:", orgRes.status, await orgRes.text())
        if (shouldIgnore()) {
          return
        }
        setOrgDetails(null)
      }

      if (includeCaptureSettings && captureSettingsRes) {
        if (captureSettingsRes.ok) {
          const data = await captureSettingsRes.json()
          if (shouldIgnore()) {
            return
          }
          setCaptureSettings(data.settings ?? null)
          setCaptureSettingsError(null)
        } else {
          const body = await captureSettingsRes.json().catch(() => ({}))
          if (shouldIgnore()) {
            return
          }
          const message =
            typeof body?.error === "string"
              ? body.error
              : `Failed to fetch GitHub capture settings (${captureSettingsRes.status})`
          setCaptureSettings(body?.settings ?? null)
          setCaptureSettingsError(message)
        }
      } else if (!shouldIgnore()) {
        setCaptureSettings(null)
        setCaptureSettingsError(null)
      }

      if (includeAudit) {
        const auditRes = await fetch(`/api/orgs/${orgId}/audit?limit=40`)
        if (shouldIgnore()) {
          return
        }
        if (auditRes.ok) {
          const data = await auditRes.json()
          if (shouldIgnore()) {
            return
          }
          setAuditEvents(data.events || [])
          setAuditError(null)
        } else {
          const body = await auditRes.json().catch(() => ({}))
          if (shouldIgnore()) {
            return
          }
          const message =
            typeof body?.error === "string"
              ? body.error
              : `Failed to fetch audit log (${auditRes.status})`
          setAuditEvents([])
          setAuditError(message)
        }
      } else if (!shouldIgnore()) {
        setAuditEvents([])
        setAuditError(null)
      }
    } catch (error) {
      if (shouldIgnore()) {
        return
      }
      console.error("Error fetching org data:", error)
      if (includeCaptureSettings) {
        setCaptureSettings(null)
        setCaptureSettingsError("Failed to load GitHub capture settings")
      }
      if (includeAudit) {
        setAuditEvents([])
        setAuditError("Failed to fetch audit log")
      }
    } finally {
      if (!shouldIgnore()) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (selectedOrgId) {
      const selectedOrgRole = organizations.find((org) => org.id === selectedOrgId)?.role
      const includeAudit = selectedOrgRole === "owner" || selectedOrgRole === "admin"
      void fetchOrgData(selectedOrgId, { includeAudit, includeCaptureSettings: includeAudit })
    } else {
      orgDataRequestIdRef.current += 1
      setOrgDetails(null)
      setAuditEvents([])
      setAuditError(null)
      setCaptureSettings(null)
      setCaptureSettingsError(null)
    }
  }, [organizations, selectedOrgId])

  useEffect(() => {
    if (!selectedOrgRecordId) return
    setDomainAutoJoinEnabled(Boolean(selectedOrgRecordDomainEnabled))
    setDomainAutoJoinDomain(selectedOrgRecordDomain ?? "")
    setDomainSettingsError(null)
    setDomainSettingsSuccess(null)
  }, [selectedOrgRecordId, selectedOrgRecordDomainEnabled, selectedOrgRecordDomain])

  useEffect(() => {
    if (!captureSettings) {
      setAllowedEvents([])
      setIncludePrerelease(true)
      setRepoAllowListText("")
      setRepoBlockListText("")
      setBranchFiltersText("")
      setLabelFiltersText("")
      setActorFiltersText("")
      setCaptureSettingsSuccess(null)
      return
    }

    setAllowedEvents(captureSettings.allowed_events)
    setIncludePrerelease(captureSettings.include_prerelease)
    setRepoAllowListText(formatListField(captureSettings.repo_allow_list))
    setRepoBlockListText(formatListField(captureSettings.repo_block_list))
    setBranchFiltersText(formatListField(captureSettings.branch_filters))
    setLabelFiltersText(formatListField(captureSettings.label_filters))
    setActorFiltersText(formatListField(captureSettings.actor_filters))
    setCaptureSettingsSuccess(null)
  }, [captureSettings])

  async function createOrganization() {
    if (!newOrgName.trim()) return
    
    setLoading(true)
    setCreateError(null)
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newOrgName.trim() }),
      })
      
      const data = await res.json()
      
      if (res.ok) {
        setShowCreateOrg(false)
        setNewOrgName("")
        router.refresh()
      } else {
        console.error("Failed to create organization:", data)
        setCreateError(data.error || "Failed to create organization. Please try again.")
      }
    } catch (e) {
      console.error("Network error creating organization:", e)
      setCreateError("Network error. Please check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  async function removeMember(memberUserId: string) {
    if (!confirm("Are you sure you want to remove this member?")) return
    
    try {
      const res = await fetch(`/api/orgs/${selectedOrgId}/members?userId=${memberUserId}`, {
        method: "DELETE",
      })
      
      if (res.ok && selectedOrgId) {
        fetchOrgData(selectedOrgId, { includeAudit: isAdmin, includeCaptureSettings: isAdmin })
      }
    } catch (e) {
      console.error(e)
    }
  }

  async function revokeInvite(inviteId: string) {
    try {
      await fetch(`/api/orgs/${selectedOrgId}/invites?inviteId=${inviteId}`, {
        method: "DELETE",
      })
      if (selectedOrgId) fetchOrgData(selectedOrgId, { includeAudit: isAdmin, includeCaptureSettings: isAdmin })
    } catch (e) {
      console.error(e)
    }
  }

  async function updateRole(memberUserId: string, newRole: string) {
    try {
      const res = await fetch(`/api/orgs/${selectedOrgId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: memberUserId, role: newRole }),
      })
      
      if (res.ok && selectedOrgId) {
        fetchOrgData(selectedOrgId, { includeAudit: isAdmin, includeCaptureSettings: isAdmin })
      }
    } catch (e) {
      console.error(e)
    }
  }

  async function saveDomainAutoJoinSettings() {
    if (!selectedOrgId || !selectedOrgRecord) return

    setSavingDomainSettings(true)
    setDomainSettingsError(null)
    setDomainSettingsSuccess(null)

    try {
      const res = await fetch(`/api/orgs/${selectedOrgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain_auto_join_enabled: domainAutoJoinEnabled,
          domain_auto_join_domain: domainAutoJoinDomain.trim() || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setDomainSettingsError(data.error || "Failed to update domain auto-join settings")
        return
      }

      setOrgDetails(data.organization ?? null)
      setDomainSettingsSuccess("Domain auto-join settings updated.")
      if (selectedOrgId) {
        fetchOrgData(selectedOrgId, { includeAudit: isAdmin, includeCaptureSettings: isAdmin })
      }
    } catch (error) {
      console.error("Failed to update domain auto-join settings:", error)
      setDomainSettingsError("Failed to update settings. Please try again.")
    } finally {
      setSavingDomainSettings(false)
    }
  }

  function toggleAllowedEvent(event: "pull_request" | "issues" | "push" | "release") {
    setAllowedEvents((previous) =>
      previous.includes(event)
        ? previous.filter((existing) => existing !== event)
        : [...previous, event]
    )
  }

  async function saveGithubCaptureSettings() {
    if (!selectedOrgId || !isAdmin) return
    if (allowedEvents.length === 0) {
      setCaptureSettingsError("Select at least one event type to capture.")
      return
    }

    setSavingCaptureSettings(true)
    setCaptureSettingsError(null)
    setCaptureSettingsSuccess(null)

    try {
      const response = await fetch(`/api/orgs/${selectedOrgId}/github-capture/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowed_events: allowedEvents,
          repo_allow_list: parsedRepoAllowList,
          repo_block_list: parsedRepoBlockList,
          branch_filters: parsedBranchFilters,
          label_filters: parsedLabelFilters,
          actor_filters: parsedActorFilters,
          include_prerelease: includePrerelease,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setCaptureSettingsError(data.error || "Failed to save GitHub capture settings")
        return
      }

      setCaptureSettings(data.settings ?? null)
      setCaptureSettingsSuccess("GitHub capture policy updated.")
      fetchOrgData(selectedOrgId, { includeAudit: isAdmin, includeCaptureSettings: true })
    } catch (error) {
      console.error("Failed to update GitHub capture settings:", error)
      setCaptureSettingsError("Failed to save GitHub capture settings")
    } finally {
      setSavingCaptureSettings(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your organization and team members
          </p>
        </div>
        <button
          onClick={() => setShowCreateOrg(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Organization
        </button>
      </div>

      {/* Create Org Modal */}
      {showCreateOrg && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-2">Create Organization</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Teams let you share rules and memories with your collaborators.
            </p>
            
            {createError && (
              <div className="bg-red-500/10 border border-red-500/20 p-3 mb-4 text-sm text-red-400">
                {createError}
              </div>
            )}
            
            <input
              type="text"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="Organization name"
              className="w-full px-3 py-2 bg-muted/30 border border-border text-sm focus:outline-none focus:border-primary mb-4"
              autoFocus
            />

            <div className="bg-muted/20 border border-border p-4 mb-4">
              <h3 className="text-sm font-semibold mb-2">Team Pricing</h3>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-green-400" />
                  <span>You (owner) — <span className="text-foreground">Free</span></span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-green-400" />
                  <span>Each additional member — <span className="text-foreground">$15/mo</span> or <span className="text-foreground">$150/year</span></span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-green-400" />
                  <span>Shared rules & memories</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-green-400" />
                  <span>Team dashboard & analytics</span>
                </li>
              </ul>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCreateOrg(false); setCreateError(null) }}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createOrganization}
                disabled={!newOrgName.trim() || loading}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Organization"}
              </button>
            </div>
          </div>
        </div>
      )}

      {organizations.length === 0 ? (
        <div className="border border-border bg-card/20 p-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No Organizations Yet</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Create an organization to collaborate with your team and share rules.
          </p>
          <p className="text-xs text-muted-foreground mb-6">
            Free to create • <span className="text-foreground">$15/mo or $150/year per member</span>
          </p>
          <button
            onClick={() => setShowCreateOrg(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create Organization
          </button>
        </div>
      ) : (
        <>
          {/* Org Selector (view-only tabs — use header switcher to change workspace) */}
          <div className="flex items-center gap-3 flex-wrap">
            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => setSelectedOrgId(org.id)}
                className={`flex items-center gap-2 px-3 py-1.5 border text-sm transition-colors ${
                  selectedOrgId === org.id
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {roleIcon(org.role)}
                <span className="font-medium">{org.name}</span>
              </button>
            ))}
          </div>

          {!selectedOrg && (
            <div className="border border-border bg-card/20 p-4">
              <p className="text-sm text-muted-foreground">
                Select an organization above to manage members and shared memory.
              </p>
            </div>
          )}

          {selectedOrg && (
            <>
              {/* Org Info */}
              <div className="border border-border bg-card/20">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary">
                      {selectedOrg.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <h2 className="font-semibold">{selectedOrg.name}</h2>
                      <p className="text-xs text-muted-foreground">/{selectedOrg.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {roleIcon(selectedOrg.role)}
                    <span className="text-xs text-muted-foreground capitalize">{selectedOrg.role}</span>
                  </div>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-sm text-muted-foreground">
                      {members.length} {members.length === 1 ? "member" : "members"}
                    </div>
                    {isOwner && members.length > 1 && (
                      <div className="text-xs text-muted-foreground">
                        Est. billing: <span className="text-foreground font-medium">${(members.length - 1) * 15}/mo</span>
                      </div>
                    )}
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => setShowInvite(true)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                    >
                      <Mail className="h-3 w-3" />
                      Invite Member
                    </button>
                  )}
                </div>
              </div>

              {/* Memory Migration — owners/admins only */}
              {isAdmin && <MemoryMigrationCard orgId={selectedOrg.id} />}

              {isOwner && selectedOrgRecord && (
                <div className="border border-border bg-card/20 p-4 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">Domain Auto-Join</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Allow anyone with your company email domain to join this organization as a member.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDomainAutoJoinEnabled((prev) => !prev)}
                      aria-label="Toggle domain auto-join"
                      role="switch"
                      aria-checked={domainAutoJoinEnabled}
                      className={`relative inline-flex h-6 w-11 items-center border transition-colors ${
                        domainAutoJoinEnabled
                          ? "bg-primary/20 border-primary/40"
                          : "bg-muted/30 border-border"
                      }`}
                      aria-pressed={domainAutoJoinEnabled}
                    >
                      <span
                        className={`inline-block h-4 w-4 bg-foreground transition-transform ${
                          domainAutoJoinEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
                      Allowed Domain
                    </label>
                    <input
                      type="text"
                      value={domainAutoJoinDomain}
                      onChange={(event) => setDomainAutoJoinDomain(event.target.value)}
                      placeholder="company.com"
                      className="w-full px-3 py-2 bg-muted/30 border border-border text-sm focus:outline-none focus:border-primary"
                    />
                    <p className="text-xs text-muted-foreground">
                      Users matching this domain can self-join on sign-in. New members count toward paid seats.
                    </p>
                  </div>

                  {domainSettingsError ? (
                    <p className="text-xs text-red-400">{domainSettingsError}</p>
                  ) : null}
                  {domainSettingsSuccess ? (
                    <p className="text-xs text-emerald-400">{domainSettingsSuccess}</p>
                  ) : null}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={saveDomainAutoJoinSettings}
                      disabled={!domainSettingsDirty || savingDomainSettings}
                      className="px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      {savingDomainSettings ? "Saving..." : "Save Domain Settings"}
                    </button>
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="border border-border bg-card/20 p-4 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">GitHub Capture Policy</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Enforce org-level capture rules before webhook items are added to review queue.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
                      Allowed Events
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: "pull_request", label: "PR" },
                        { value: "issues", label: "Issue" },
                        { value: "push", label: "Push" },
                        { value: "release", label: "Release" },
                      ].map((eventOption) => {
                        const isActive = allowedEvents.includes(
                          eventOption.value as "pull_request" | "issues" | "push" | "release"
                        )
                        return (
                          <button
                            key={eventOption.value}
                            type="button"
                            onClick={() =>
                              toggleAllowedEvent(
                                eventOption.value as "pull_request" | "issues" | "push" | "release"
                              )
                            }
                            className={`px-2.5 py-1.5 border text-xs tracking-[0.08em] transition-colors ${
                              isActive
                                ? "border-primary/40 bg-primary/10 text-foreground"
                                : "border-border bg-muted/20 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {eventOption.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-4 border border-border bg-muted/10 px-3 py-2.5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
                        Prerelease Handling
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        When disabled, prerelease GitHub release events are ignored before enqueue.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIncludePrerelease((previous) => !previous)}
                      aria-label="Toggle prerelease handling"
                      role="switch"
                      aria-checked={includePrerelease}
                      className={`relative inline-flex h-6 w-11 items-center border transition-colors ${
                        includePrerelease
                          ? "bg-primary/20 border-primary/40"
                          : "bg-muted/30 border-border"
                      }`}
                      aria-pressed={includePrerelease}
                    >
                      <span
                        className={`inline-block h-4 w-4 bg-foreground transition-transform ${
                          includePrerelease ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
                        Repo Allow List
                      </label>
                      <textarea
                        value={repoAllowListText}
                        onChange={(event) => setRepoAllowListText(event.target.value)}
                        placeholder="webrenew/memories"
                        rows={4}
                        className="w-full px-3 py-2 bg-muted/30 border border-border text-xs font-mono focus:outline-none focus:border-primary resize-y"
                      />
                      <p className="text-[11px] text-muted-foreground">Leave blank to allow all repositories.</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
                        Repo Block List
                      </label>
                      <textarea
                        value={repoBlockListText}
                        onChange={(event) => setRepoBlockListText(event.target.value)}
                        placeholder="example/private-repo"
                        rows={4}
                        className="w-full px-3 py-2 bg-muted/30 border border-border text-xs font-mono focus:outline-none focus:border-primary resize-y"
                      />
                      <p className="text-[11px] text-muted-foreground">Blocked repos are always ignored.</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
                        Branch Filters
                      </label>
                      <textarea
                        value={branchFiltersText}
                        onChange={(event) => setBranchFiltersText(event.target.value)}
                        placeholder="main\nrelease/*"
                        rows={4}
                        className="w-full px-3 py-2 bg-muted/30 border border-border text-xs font-mono focus:outline-none focus:border-primary resize-y"
                      />
                      <p className="text-[11px] text-muted-foreground">Applies to PR, push, and release targets.</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
                        Label Filters
                      </label>
                      <textarea
                        value={labelFiltersText}
                        onChange={(event) => setLabelFiltersText(event.target.value)}
                        placeholder="memory\ndocs"
                        rows={4}
                        className="w-full px-3 py-2 bg-muted/30 border border-border text-xs font-mono focus:outline-none focus:border-primary resize-y"
                      />
                      <p className="text-[11px] text-muted-foreground">Applies to PR and issue labels.</p>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
                        Actor Filters
                      </label>
                      <textarea
                        value={actorFiltersText}
                        onChange={(event) => setActorFiltersText(event.target.value)}
                        placeholder="charles\nbot-*"
                        rows={3}
                        className="w-full px-3 py-2 bg-muted/30 border border-border text-xs font-mono focus:outline-none focus:border-primary resize-y"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Restrict to GitHub actors/logins. Supports <code>*</code> wildcards.
                      </p>
                    </div>
                  </div>

                  {captureSettingsError ? (
                    <p className="text-xs text-red-400">{captureSettingsError}</p>
                  ) : null}
                  {captureSettingsSuccess ? (
                    <p className="text-xs text-emerald-400">{captureSettingsSuccess}</p>
                  ) : null}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={saveGithubCaptureSettings}
                      disabled={!captureSettingsDirty || savingCaptureSettings}
                      className="px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      {savingCaptureSettings ? "Saving..." : "Save Capture Policy"}
                    </button>
                  </div>
                </div>
              )}

              {/* Invite Modal */}
              {showInvite && selectedOrgId && (
                <InviteModal
                  orgId={selectedOrgId}
                  isOwner={isOwner}
                  loading={loading}
                  onClose={() => setShowInvite(false)}
                  onInviteSent={() => {
                    if (selectedOrgId) {
                      fetchOrgData(selectedOrgId, { includeAudit: isAdmin, includeCaptureSettings: isAdmin })
                    }
                  }}
                />
              )}

              {/* Members List */}
              <div className="border border-border bg-card/20">
                <div className="p-4 border-b border-border">
                  <h3 className="font-semibold">Members</h3>
                </div>
                <div className="hidden md:grid md:grid-cols-[minmax(0,2fr)_130px_220px_220px_auto] gap-3 px-4 py-2 border-b border-border text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                  <span>Member</span>
                  <span>Role</span>
                  <span>Last Login</span>
                  <span>Memory</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="divide-y divide-border">
                  {members.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No members found for this organization yet.</div>
                  ) : (
                    members.map((member) => (
                      <div
                        key={member.id}
                        className="p-4 grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_130px_220px_220px_auto] gap-3 md:items-center"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {member.user.avatar_url ? (
                            <Image
                              src={member.user.avatar_url}
                              alt=""
                              width={36}
                              height={36}
                              className="rounded-full border border-border"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-bold">
                              {(member.user.name || member.user.email)[0]?.toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {member.user.name || member.user.email.split("@")[0]}
                              {member.user.id === userId && (
                                <span className="text-xs text-muted-foreground ml-2">(you)</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{member.user.email}</p>
                          </div>
                        </div>

                        <div className="flex md:block items-center gap-2">
                          <span className="md:hidden text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                            Role
                          </span>
                          <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted/30 border border-border">
                            {roleIcon(member.role)}
                            <span className="text-xs capitalize">{member.role}</span>
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          <span className="md:hidden block text-[10px] uppercase tracking-[0.16em] mb-1 text-muted-foreground/70">
                            Last Login
                          </span>
                          <span>{formatLastLogin(member.last_login_at)}</span>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          <span className="md:hidden block text-[10px] uppercase tracking-[0.16em] mb-1 text-muted-foreground/70">
                            Memory
                          </span>
                          <div className="space-y-0.5">
                            <p>
                              Workspace:{" "}
                              <span className="text-foreground font-medium">
                                {(member.memory_count ?? 0).toLocaleString()}
                              </span>
                            </p>
                            <p>
                              User-scoped:{" "}
                              <span className="text-foreground font-medium">
                                {(member.user_memory_count ?? 0).toLocaleString()}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 md:justify-end">
                          {isAdmin && member.role !== "owner" && member.user.id !== userId ? (
                            <>
                              {isOwner && (
                                <select
                                  value={member.role}
                                  onChange={(e) => updateRole(member.user.id, e.target.value)}
                                  className="px-2 py-1 bg-muted/30 border border-border text-xs focus:outline-none"
                                >
                                  <option value="member">Member</option>
                                  <option value="admin">Admin</option>
                                </select>
                              )}
                              <button
                                onClick={() => removeMember(member.user.id)}
                                className="p-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Remove member"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Pending Invites */}
              {isAdmin && invites.length > 0 && (
                <div className="border border-border bg-card/20">
                  <div className="p-4 border-b border-border">
                    <h3 className="font-semibold">Pending Invites</h3>
                  </div>
                  <div className="divide-y divide-border">
                    {invites.map(invite => (
                      <div key={invite.id} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{invite.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Invited as {invite.role} · Expires {new Date(invite.expires_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={() => revokeInvite(invite.id)}
                          className="p-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Revoke invite"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="border border-border bg-card/20">
                  <div className="p-4 border-b border-border flex items-center justify-between gap-3">
                    <h3 className="font-semibold">Audit Log</h3>
                    <p className="text-xs text-muted-foreground">{auditEvents.length} recent events</p>
                  </div>
                  {auditError ? (
                    <div className="p-4 text-sm text-red-400">{auditError}</div>
                  ) : auditEvents.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No audit events yet.</div>
                  ) : (
                    <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
                      {auditEvents.map((event) => {
                        const actorLabel =
                          event.actor?.name ||
                          event.actor?.email ||
                          (event.actor_user_id === userId ? "You" : "System")
                        const metadataSummary = summarizeAuditMetadata(event.metadata)

                        return (
                          <div key={event.id} className="p-4 space-y-1.5">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs uppercase tracking-[0.14em] text-primary/90 font-semibold">
                                {formatAuditAction(event.action)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(event.created_at).toLocaleString()}
                              </p>
                            </div>
                            <p className="text-sm">
                              <span className="text-muted-foreground">Actor:</span> {actorLabel}
                            </p>
                            <p className="text-sm">
                              <span className="text-muted-foreground">Target:</span>{" "}
                              {event.target_label || event.target_id || "—"}
                            </p>
                            {metadataSummary ? (
                              <p className="text-xs text-muted-foreground font-mono">{metadataSummary}</p>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
