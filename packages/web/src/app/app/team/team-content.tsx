"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
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
import type {
  Organization,
  OrganizationDetails,
  GithubCaptureSettings,
  Member,
  Invite,
  AuditEvent,
} from "./team-types"
import {
  formatLastLogin,
  formatAuditAction,
  summarizeAuditMetadata,
  formatListField,
  parseListField,
  sameStringList,
} from "./team-helpers"

function roleIcon(role: string) {
  switch (role) {
    case "owner": return <Crown className="h-3 w-3 text-amber-400" />
    case "admin": return <Shield className="h-3 w-3 text-blue-400" />
    default: return <User className="h-3 w-3 text-muted-foreground" />
  }
}

const MEMBER_PAGE_SIZE = 10
const MEMBER_ROLE_FILTERS = ["all", "owner", "admin", "member"] as const
type MemberRoleFilter = (typeof MEMBER_ROLE_FILTERS)[number]
const MEMBER_DESKTOP_GRID_CLASS =
  "md:grid-cols-[36px_minmax(0,2fr)_130px_220px_220px_170px]"

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
  const [memberSearch, setMemberSearch] = useState("")
  const [memberRoleFilter, setMemberRoleFilter] = useState<MemberRoleFilter>("all")
  const [memberPage, setMemberPage] = useState(1)
  const [selectedMemberUserIds, setSelectedMemberUserIds] = useState<string[]>([])
  const [bulkActionInFlight, setBulkActionInFlight] = useState(false)
  const [memberActionError, setMemberActionError] = useState<string | null>(null)
  const [memberActionSuccess, setMemberActionSuccess] = useState<string | null>(null)
  const [bulkRoleValue, setBulkRoleValue] = useState<"member" | "admin">("member")
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
  const [domainSettingsUpgradeUrl, setDomainSettingsUpgradeUrl] = useState<string | null>(null)
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
  const canManageMember = useCallback(
    (member: Member) => isAdmin && member.role !== "owner" && member.user.id !== userId,
    [isAdmin, userId]
  )

  const filteredMembers = useMemo(() => {
    const searchQuery = memberSearch.trim().toLowerCase()
    return members.filter((member) => {
      if (memberRoleFilter !== "all" && member.role !== memberRoleFilter) {
        return false
      }
      if (!searchQuery) {
        return true
      }

      const searchHaystack = [
        member.user.name ?? "",
        member.user.email,
        member.user.id,
      ]
        .join(" ")
        .toLowerCase()

      return searchHaystack.includes(searchQuery)
    })
  }, [memberRoleFilter, memberSearch, members])

  const memberPageCount = Math.max(1, Math.ceil(filteredMembers.length / MEMBER_PAGE_SIZE))
  const pagedMembers = useMemo(() => {
    const start = (memberPage - 1) * MEMBER_PAGE_SIZE
    return filteredMembers.slice(start, start + MEMBER_PAGE_SIZE)
  }, [filteredMembers, memberPage])

  const visibleSelectableMemberIds = useMemo(
    () => pagedMembers.filter(canManageMember).map((member) => member.user.id),
    [pagedMembers, canManageMember]
  )

  const allVisibleSelectableMembersSelected =
    visibleSelectableMemberIds.length > 0 &&
    visibleSelectableMemberIds.every((memberUserId) => selectedMemberUserIds.includes(memberUserId))

  const selectedMemberIds = useMemo(
    () => selectedMemberUserIds.filter((memberUserId) => members.some((member) => member.user.id === memberUserId)),
    [members, selectedMemberUserIds]
  )

  const selectedManageableMemberIds = useMemo(
    () => selectedMemberIds.filter((memberUserId) => {
      const member = members.find((row) => row.user.id === memberUserId)
      return member ? canManageMember(member) : false
    }),
    [canManageMember, members, selectedMemberIds]
  )

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
    setMemberSearch("")
    setMemberRoleFilter("all")
    setMemberPage(1)
    setSelectedMemberUserIds([])
    setMemberActionError(null)
    setMemberActionSuccess(null)
  }, [selectedOrgId])

  useEffect(() => {
    setMemberPage(1)
  }, [memberSearch, memberRoleFilter])

  useEffect(() => {
    if (memberPage <= memberPageCount) return
    setMemberPage(memberPageCount)
  }, [memberPage, memberPageCount])

  useEffect(() => {
    setSelectedMemberUserIds((previous) =>
      previous.filter((memberUserId) => {
        const member = members.find((row) => row.user.id === memberUserId)
        return member ? canManageMember(member) : false
      })
    )
  }, [canManageMember, members])

  useEffect(() => {
    if (!selectedOrgRecordId) return
    setDomainAutoJoinEnabled(Boolean(selectedOrgRecordDomainEnabled))
    setDomainAutoJoinDomain(selectedOrgRecordDomain ?? "")
    setDomainSettingsError(null)
    setDomainSettingsSuccess(null)
    setDomainSettingsUpgradeUrl(null)
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

  async function requestMemberRemoval(memberUserId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(`/api/orgs/${selectedOrgId}/members?userId=${memberUserId}`, {
        method: "DELETE",
      })

      if (res.ok) {
        return { ok: true }
      }

      const body = await res.json().catch(() => ({}))
      const errorMessage =
        typeof body?.error === "string"
          ? body.error
          : `Failed to remove member (${res.status})`
      return { ok: false, error: errorMessage }
    } catch (error) {
      console.error(error)
      return { ok: false, error: "Failed to remove member" }
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

  async function removeMember(memberUserId: string) {
    if (!confirm("Are you sure you want to remove this member?")) return

    setMemberActionError(null)
    setMemberActionSuccess(null)
    const result = await requestMemberRemoval(memberUserId)
    if (!result.ok) {
      setMemberActionError(result.error)
      return
    }

    setSelectedMemberUserIds((previous) => previous.filter((id) => id !== memberUserId))
    setMemberActionSuccess("Member removed.")
    if (selectedOrgId) {
      fetchOrgData(selectedOrgId, { includeAudit: isAdmin, includeCaptureSettings: isAdmin })
    }
  }

  async function requestRoleUpdate(
    memberUserId: string,
    newRole: "member" | "admin"
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(`/api/orgs/${selectedOrgId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: memberUserId, role: newRole }),
      })

      if (res.ok) {
        return { ok: true }
      }

      const body = await res.json().catch(() => ({}))
      const errorMessage =
        typeof body?.error === "string"
          ? body.error
          : `Failed to update member role (${res.status})`
      return { ok: false, error: errorMessage }
    } catch (error) {
      console.error(error)
      return { ok: false, error: "Failed to update member role" }
    }
  }

  async function updateRole(memberUserId: string, newRole: "member" | "admin") {
    setMemberActionError(null)
    setMemberActionSuccess(null)
    const result = await requestRoleUpdate(memberUserId, newRole)
    if (!result.ok) {
      setMemberActionError(result.error)
      return
    }

    setMemberActionSuccess("Member role updated.")
    if (selectedOrgId) {
      fetchOrgData(selectedOrgId, { includeAudit: isAdmin, includeCaptureSettings: isAdmin })
    }
  }

  function toggleMemberSelection(memberUserId: string) {
    setSelectedMemberUserIds((previous) =>
      previous.includes(memberUserId)
        ? previous.filter((id) => id !== memberUserId)
        : [...previous, memberUserId]
    )
  }

  function toggleVisibleMemberSelection() {
    if (visibleSelectableMemberIds.length === 0) return

    setSelectedMemberUserIds((previous) => {
      if (allVisibleSelectableMembersSelected) {
        return previous.filter((id) => !visibleSelectableMemberIds.includes(id))
      }

      const next = new Set(previous)
      for (const memberUserId of visibleSelectableMemberIds) {
        next.add(memberUserId)
      }
      return Array.from(next)
    })
  }

  async function applyBulkRoleChange() {
    if (!isOwner || selectedManageableMemberIds.length === 0) return
    if (
      !confirm(
        `Change role to ${bulkRoleValue} for ${selectedManageableMemberIds.length} selected member${
          selectedManageableMemberIds.length === 1 ? "" : "s"
        }?`
      )
    ) {
      return
    }

    setBulkActionInFlight(true)
    setMemberActionError(null)
    setMemberActionSuccess(null)

    let failures = 0
    let firstError: string | null = null

    for (const memberUserId of selectedManageableMemberIds) {
      const result = await requestRoleUpdate(memberUserId, bulkRoleValue)
      if (!result.ok) {
        failures += 1
        firstError = firstError ?? result.error
      }
    }

    if (selectedOrgId) {
      await fetchOrgData(selectedOrgId, { includeAudit: isAdmin, includeCaptureSettings: isAdmin })
    }
    setSelectedMemberUserIds([])
    setBulkActionInFlight(false)

    const successCount = selectedManageableMemberIds.length - failures
    if (failures > 0) {
      setMemberActionError(
        `${firstError ?? "Some role updates failed"}. Updated ${successCount} of ${selectedManageableMemberIds.length}.`
      )
      return
    }
    setMemberActionSuccess(
      `Updated role for ${successCount} member${successCount === 1 ? "" : "s"}.`
    )
  }

  async function removeSelectedMembers() {
    if (!isAdmin || selectedManageableMemberIds.length === 0) return
    if (
      !confirm(
        `Remove ${selectedManageableMemberIds.length} selected member${
          selectedManageableMemberIds.length === 1 ? "" : "s"
        }?`
      )
    ) {
      return
    }

    setBulkActionInFlight(true)
    setMemberActionError(null)
    setMemberActionSuccess(null)

    let failures = 0
    let firstError: string | null = null

    for (const memberUserId of selectedManageableMemberIds) {
      const result = await requestMemberRemoval(memberUserId)
      if (!result.ok) {
        failures += 1
        firstError = firstError ?? result.error
      }
    }

    if (selectedOrgId) {
      await fetchOrgData(selectedOrgId, { includeAudit: isAdmin, includeCaptureSettings: isAdmin })
    }
    setSelectedMemberUserIds([])
    setBulkActionInFlight(false)

    const successCount = selectedManageableMemberIds.length - failures
    if (failures > 0) {
      setMemberActionError(
        `${firstError ?? "Some members could not be removed"}. Removed ${successCount} of ${selectedManageableMemberIds.length}.`
      )
      return
    }
    setMemberActionSuccess(
      `Removed ${successCount} member${successCount === 1 ? "" : "s"}.`
    )
  }

  async function saveDomainAutoJoinSettings() {
    if (!selectedOrgId || !selectedOrgRecord) return

    const nextDomain = domainAutoJoinDomain.trim()
    const currentDomain = (selectedOrgRecord.domain_auto_join_domain ?? "").trim().toLowerCase()
    const nextDomainNormalized = nextDomain.toLowerCase()
    const domainChanged = nextDomainNormalized !== currentDomain
    const nextEnabled =
      domainChanged && nextDomain.length > 0
        ? true
        : domainChanged && nextDomain.length === 0
          ? false
          : domainAutoJoinEnabled

    setSavingDomainSettings(true)
    setDomainSettingsError(null)
    setDomainSettingsSuccess(null)
    setDomainSettingsUpgradeUrl(null)

    try {
      const res = await fetch(`/api/orgs/${selectedOrgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain_auto_join_enabled: nextEnabled,
          domain_auto_join_domain: nextDomain || null,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDomainSettingsError(data.error || "Failed to update domain auto-join settings")
        if (res.status === 402 && typeof data.upgradeUrl === "string") {
          setDomainSettingsUpgradeUrl(data.upgradeUrl)
        }
        return
      }

      setOrgDetails(data.organization ?? null)
      setDomainAutoJoinEnabled(Boolean(data.organization?.domain_auto_join_enabled ?? nextEnabled))
      setDomainAutoJoinDomain(data.organization?.domain_auto_join_domain ?? (nextDomain || ""))
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

                  {domainSettingsUpgradeUrl ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => router.push(domainSettingsUpgradeUrl)}
                        className="px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                      >
                        Upgrade to Team
                      </button>
                    </div>
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
                <div className="p-4 border-b border-border space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">Members</h3>
                    <p className="text-xs text-muted-foreground">
                      Showing {filteredMembers.length} of {members.length}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <input
                      type="text"
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      placeholder="Search by name, email, or user id"
                      className="w-full md:flex-1 px-3 py-2 bg-muted/30 border border-border text-sm focus:outline-none focus:border-primary"
                    />
                    <select
                      value={memberRoleFilter}
                      onChange={(event) => setMemberRoleFilter(event.target.value as MemberRoleFilter)}
                      className="w-full md:w-[160px] px-3 py-2 bg-muted/30 border border-border text-sm focus:outline-none focus:border-primary capitalize"
                    >
                      {MEMBER_ROLE_FILTERS.map((role) => (
                        <option key={role} value={role} className="capitalize">
                          {role === "all" ? "All Roles" : role}
                        </option>
                      ))}
                    </select>
                  </div>

                  {memberActionError ? (
                    <p className="text-xs text-red-400">{memberActionError}</p>
                  ) : null}
                  {memberActionSuccess ? (
                    <p className="text-xs text-emerald-400">{memberActionSuccess}</p>
                  ) : null}

                  {isAdmin && (selectedManageableMemberIds.length > 0 || bulkActionInFlight) ? (
                    <div className="border border-border bg-muted/10 px-3 py-2.5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <p className="text-xs text-muted-foreground">
                        {selectedManageableMemberIds.length} selected
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {isOwner ? (
                          <>
                            <select
                              value={bulkRoleValue}
                              onChange={(event) => setBulkRoleValue(event.target.value as "member" | "admin")}
                              disabled={selectedManageableMemberIds.length === 0 || bulkActionInFlight}
                              className="px-2 py-1 bg-muted/30 border border-border text-xs focus:outline-none disabled:opacity-50"
                            >
                              <option value="member">Set Member</option>
                              <option value="admin">Set Admin</option>
                            </select>
                            <button
                              type="button"
                              onClick={applyBulkRoleChange}
                              disabled={selectedManageableMemberIds.length === 0 || bulkActionInFlight}
                              className="px-2.5 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
                            >
                              {bulkActionInFlight ? "Applying..." : "Apply Role"}
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          onClick={removeSelectedMembers}
                          disabled={selectedManageableMemberIds.length === 0 || bulkActionInFlight}
                          className="px-2.5 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        >
                          {bulkActionInFlight ? "Removing..." : "Remove Selected"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedMemberUserIds([])}
                          disabled={selectedManageableMemberIds.length === 0 || bulkActionInFlight}
                          className="px-2.5 py-1.5 bg-muted/30 border border-border text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className={`hidden md:grid ${MEMBER_DESKTOP_GRID_CLASS} gap-3 px-4 py-2 border-b border-border text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70`}>
                  <span className="flex items-center">
                    <input
                      type="checkbox"
                      disabled={visibleSelectableMemberIds.length === 0 || bulkActionInFlight}
                      checked={allVisibleSelectableMembersSelected}
                      onChange={toggleVisibleMemberSelection}
                      className="h-3.5 w-3.5 accent-primary"
                      aria-label="Select all visible members"
                    />
                  </span>
                  <span>Member</span>
                  <span>Role</span>
                  <span>Last Login</span>
                  <span>Memory</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="divide-y divide-border">
                  {filteredMembers.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      No members match your current search/filter.
                    </div>
                  ) : (
                    pagedMembers.map((member) => {
                      const manageable = canManageMember(member)
                      const selected = selectedMemberIds.includes(member.user.id)

                      return (
                        <div
                          key={member.id}
                          className={`p-4 grid grid-cols-1 ${MEMBER_DESKTOP_GRID_CLASS} gap-3 md:items-center`}
                        >
                          <div className="hidden md:flex items-center justify-center">
                            <input
                              type="checkbox"
                              disabled={!manageable || bulkActionInFlight}
                              checked={selected}
                              onChange={() => toggleMemberSelection(member.user.id)}
                              className="h-3.5 w-3.5 accent-primary disabled:opacity-40"
                              aria-label={`Select ${member.user.email}`}
                            />
                          </div>

                          <div className="flex items-center gap-3 min-w-0">
                            <Image
                              src={member.user.avatar_url || `https://www.gravatar.com/avatar/?d=identicon&s=96`}
                              alt=""
                              width={36}
                              height={36}
                              className="rounded-full border border-border"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium truncate">
                                  {member.user.name || member.user.email.split("@")[0]}
                                  {member.user.id === userId ? (
                                    <span className="text-xs text-muted-foreground ml-2">(you)</span>
                                  ) : null}
                                </p>
                                {manageable ? (
                                  <input
                                    type="checkbox"
                                    disabled={bulkActionInFlight}
                                    checked={selected}
                                    onChange={() => toggleMemberSelection(member.user.id)}
                                    className="md:hidden h-3.5 w-3.5 accent-primary"
                                    aria-label={`Select ${member.user.email}`}
                                  />
                                ) : null}
                              </div>
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
                            {manageable ? (
                              <>
                                {isOwner ? (
                                  <select
                                    value={member.role}
                                    onChange={(event) =>
                                      updateRole(member.user.id, event.target.value as "member" | "admin")
                                    }
                                    className="px-2 py-1 bg-muted/30 border border-border text-xs focus:outline-none"
                                    disabled={bulkActionInFlight}
                                  >
                                    <option value="member">Member</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                ) : null}
                                <button
                                  onClick={() => removeMember(member.user.id)}
                                  className="p-1.5 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                  title="Remove member"
                                  disabled={bulkActionInFlight}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {filteredMembers.length > MEMBER_PAGE_SIZE ? (
                  <div className="p-3 border-t border-border flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Page {memberPage} of {memberPageCount}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMemberPage((page) => Math.max(1, page - 1))}
                        disabled={memberPage <= 1}
                        className="px-2.5 py-1.5 bg-muted/30 border border-border text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => setMemberPage((page) => Math.min(memberPageCount, page + 1))}
                        disabled={memberPage >= memberPageCount}
                        className="px-2.5 py-1.5 bg-muted/30 border border-border text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
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
                    <div className="divide-y divide-border">
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
