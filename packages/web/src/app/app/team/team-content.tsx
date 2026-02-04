"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { 
  Users, 
  Plus, 
  Settings, 
  Crown, 
  Shield, 
  User, 
  Mail,
  Trash2,
  Copy,
  Check,
  X,
  ChevronDown
} from "lucide-react"

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
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(currentOrgId || organizations[0]?.id || null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreateOrg, setShowCreateOrg] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [newOrgName, setNewOrgName] = useState("")
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member")
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const selectedOrg = organizations.find(o => o.id === selectedOrgId)
  const isOwner = selectedOrg?.role === "owner"
  const isAdmin = selectedOrg?.role === "admin" || isOwner

  useEffect(() => {
    if (selectedOrgId) {
      fetchOrgData()
    }
  }, [selectedOrgId])

  async function fetchOrgData() {
    setLoading(true)
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`/api/orgs/${selectedOrgId}/members`),
        fetch(`/api/orgs/${selectedOrgId}/invites`),
      ])
      
      if (membersRes.ok) {
        const data = await membersRes.json()
        setMembers(data.members || [])
      }
      
      if (invitesRes.ok) {
        const data = await invitesRes.json()
        setInvites(data.invites || [])
      }
    } finally {
      setLoading(false)
    }
  }

  async function createOrganization() {
    if (!newOrgName.trim()) return
    
    setLoading(true)
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newOrgName.trim() }),
      })
      
      if (res.ok) {
        setShowCreateOrg(false)
        setNewOrgName("")
        router.refresh()
      }
    } finally {
      setLoading(false)
    }
  }

  async function inviteMember() {
    if (!inviteEmail.trim() || !selectedOrgId) return
    
    setLoading(true)
    try {
      const res = await fetch(`/api/orgs/${selectedOrgId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      
      const data = await res.json()
      
      if (res.ok) {
        setInviteUrl(data.inviteUrl)
        setInviteEmail("")
        fetchOrgData()
      } else {
        alert(data.error || "Failed to send invite")
      }
    } finally {
      setLoading(false)
    }
  }

  async function removeMember(memberId: string, memberUserId: string) {
    if (!confirm("Are you sure you want to remove this member?")) return
    
    try {
      const res = await fetch(`/api/orgs/${selectedOrgId}/members?userId=${memberUserId}`, {
        method: "DELETE",
      })
      
      if (res.ok) {
        fetchOrgData()
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
      fetchOrgData()
    } catch (e) {
      console.error(e)
    }
  }

  async function updateRole(memberId: string, memberUserId: string, newRole: string) {
    try {
      const res = await fetch(`/api/orgs/${selectedOrgId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: memberUserId, role: newRole }),
      })
      
      if (res.ok) {
        fetchOrgData()
      }
    } catch (e) {
      console.error(e)
    }
  }

  function copyInviteUrl() {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const roleIcon = (role: string) => {
    switch (role) {
      case "owner": return <Crown className="h-3 w-3 text-amber-400" />
      case "admin": return <Shield className="h-3 w-3 text-blue-400" />
      default: return <User className="h-3 w-3 text-muted-foreground" />
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
            <h2 className="text-lg font-bold mb-4">Create Organization</h2>
            <input
              type="text"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="Organization name"
              className="w-full px-3 py-2 bg-muted/30 border border-border text-sm focus:outline-none focus:border-primary mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreateOrg(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createOrganization}
                disabled={!newOrgName.trim() || loading}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {organizations.length === 0 ? (
        <div className="border border-border bg-card/20 p-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No Organizations Yet</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Create an organization to collaborate with your team and share rules.
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
          {/* Org Selector */}
          {organizations.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Organization:</span>
              <select
                value={selectedOrgId || ""}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="px-3 py-1.5 bg-muted/30 border border-border text-sm focus:outline-none focus:border-primary"
              >
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
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
                  <div className="text-sm text-muted-foreground">
                    {members.length} {members.length === 1 ? "member" : "members"}
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

              {/* Invite Modal */}
              {showInvite && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                  <div className="bg-background border border-border p-6 w-full max-w-md">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold">Invite Team Member</h2>
                      <button onClick={() => { setShowInvite(false); setInviteUrl(null) }}>
                        <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </button>
                    </div>
                    
                    {inviteUrl ? (
                      <div className="space-y-4">
                        <div className="bg-green-500/10 border border-green-500/20 p-3 text-sm">
                          <p className="text-green-400 font-medium mb-2">Invite Created!</p>
                          <p className="text-muted-foreground text-xs">
                            Share this link with the person you want to invite:
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={inviteUrl}
                            readOnly
                            className="flex-1 px-3 py-2 bg-muted/30 border border-border text-xs font-mono focus:outline-none"
                          />
                          <button
                            onClick={copyInviteUrl}
                            className={`p-2 transition-colors ${copied ? "bg-green-500/20 text-green-400" : "bg-muted/30 hover:bg-muted/50"}`}
                          >
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          </button>
                        </div>
                        <button
                          onClick={() => { setShowInvite(false); setInviteUrl(null) }}
                          className="w-full px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                          Done
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-4 mb-6">
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="Email address"
                            className="w-full px-3 py-2 bg-muted/30 border border-border text-sm focus:outline-none focus:border-primary"
                            autoFocus
                          />
                          <div className="flex items-center gap-4">
                            <span className="text-sm text-muted-foreground">Role:</span>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="role"
                                checked={inviteRole === "member"}
                                onChange={() => setInviteRole("member")}
                              />
                              <span className="text-sm">Member</span>
                            </label>
                            {isOwner && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="radio"
                                  name="role"
                                  checked={inviteRole === "admin"}
                                  onChange={() => setInviteRole("admin")}
                                />
                                <span className="text-sm">Admin</span>
                              </label>
                            )}
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setShowInvite(false)}
                            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={inviteMember}
                            disabled={!inviteEmail.trim() || loading}
                            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                          >
                            {loading ? "Sending..." : "Send Invite"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
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
                                onChange={(e) => updateRole(member.id, member.user.id, e.target.value)}
                                className="px-2 py-1 bg-muted/30 border border-border text-xs focus:outline-none"
                              >
                                <option value="member">Member</option>
                                <option value="admin">Admin</option>
                              </select>
                            )}
                            <button
                              onClick={() => removeMember(member.id, member.user.id)}
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
