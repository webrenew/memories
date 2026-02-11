"use client"

import { useState, useEffect } from "react"
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
}

interface Member {
  id: string
  role: string
  joined_at: string
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

function roleIcon(role: string) {
  switch (role) {
    case "owner": return <Crown className="h-3 w-3 text-amber-400" />
    case "admin": return <Shield className="h-3 w-3 text-blue-400" />
    default: return <User className="h-3 w-3 text-muted-foreground" />
  }
}

export function TeamContent({ 
  organizations, 
  currentOrgId,
  userId 
}: { 
  organizations: Organization[]
  currentOrgId: string | null
  userId: string
}) {
  const router = useRouter()
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(() => {
    if (!currentOrgId) return null
    return organizations.some((org) => org.id === currentOrgId) ? currentOrgId : null
  })
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreateOrg, setShowCreateOrg] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newOrgName, setNewOrgName] = useState("")

  useEffect(() => {
    if (!currentOrgId) {
      setSelectedOrgId(null)
      return
    }

    const exists = organizations.some((org) => org.id === currentOrgId)
    setSelectedOrgId(exists ? currentOrgId : null)
  }, [currentOrgId, organizations])

  const selectedOrg = organizations.find(o => o.id === selectedOrgId)
  const isOwner = selectedOrg?.role === "owner"
  const isAdmin = selectedOrg?.role === "admin" || isOwner

  async function fetchOrgData(orgId: string) {
    setLoading(true)
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`/api/orgs/${orgId}/members`),
        fetch(`/api/orgs/${orgId}/invites`),
      ])
      
      if (membersRes.ok) {
        const data = await membersRes.json()
        setMembers(data.members || [])
      } else {
        console.error("Failed to fetch members:", membersRes.status, await membersRes.text())
      }
      
      if (invitesRes.ok) {
        const data = await invitesRes.json()
        setInvites(data.invites || [])
      } else {
        console.error("Failed to fetch invites:", invitesRes.status, await invitesRes.text())
      }
    } catch (error) {
      console.error("Error fetching org data:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedOrgId) {
      fetchOrgData(selectedOrgId)
    }
  }, [selectedOrgId])

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
        fetchOrgData(selectedOrgId)
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
      if (selectedOrgId) fetchOrgData(selectedOrgId)
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
        fetchOrgData(selectedOrgId)
      }
    } catch (e) {
      console.error(e)
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

              {/* Invite Modal */}
              {showInvite && selectedOrgId && (
                <InviteModal
                  orgId={selectedOrgId}
                  isOwner={isOwner}
                  loading={loading}
                  onClose={() => setShowInvite(false)}
                  onInviteSent={() => { if (selectedOrgId) fetchOrgData(selectedOrgId) }}
                />
              )}

              {/* Members List */}
              <div className="border border-border bg-card/20">
                <div className="p-4 border-b border-border">
                  <h3 className="font-semibold">Members</h3>
                </div>
                <div className="divide-y divide-border">
                  {members.map(member => (
                    <div key={member.id} className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
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
                        <div>
                          <p className="text-sm font-medium">
                            {member.user.name || member.user.email.split("@")[0]}
                            {member.user.id === userId && (
                              <span className="text-xs text-muted-foreground ml-2">(you)</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">{member.user.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/30 border border-border">
                          {roleIcon(member.role)}
                          <span className="text-xs capitalize">{member.role}</span>
                        </div>
                        {isAdmin && member.role !== "owner" && member.user.id !== userId && (
                          <div className="flex items-center gap-1">
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
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
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
            </>
          )}
        </>
      )}
    </div>
  )
}
