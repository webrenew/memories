"use client"

import React, { useState } from "react"
import { X, Copy, Check } from "lucide-react"
import { getTeamInviteExpiryLabel } from "@/lib/team-invites"

interface InviteModalProps {
  orgId: string
  isOwner: boolean
  loading: boolean
  onClose: () => void
  onInviteSent: () => void
}

export function InviteModal({ orgId, isOwner, loading: parentLoading, onClose, onInviteSent }: InviteModalProps): React.JSX.Element {
  const inviteExpiryLabel = getTeamInviteExpiryLabel()
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member")
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  async function inviteMember() {
    if (!inviteEmail.trim()) return

    setLoading(true)
    try {
      const res = await fetch(`/api/orgs/${orgId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })

      const data = await res.json()

      if (res.ok) {
        setInviteUrl(data.inviteUrl)
        setEmailSent(data.emailSent || false)
        setInviteEmail("")
        onInviteSent()
      } else {
        alert(data.error || "Failed to send invite")
      }
    } catch (err) {
      console.error("Failed to send invite:", err)
    } finally {
      setLoading(false)
    }
  }

  function copyInviteUrl() {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleClose() {
    setInviteUrl(null)
    setEmailSent(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background border border-border p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Invite Team Member</h2>
          <button onClick={handleClose}>
            <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
        </div>

        {inviteUrl ? (
          <div className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/20 p-3 text-sm">
              <p className="text-green-400 font-medium mb-2">
                {emailSent ? "Invite Sent!" : "Invite Created!"}
              </p>
              <p className="text-muted-foreground text-xs">
                {emailSent
                  ? "We've sent an email with the invite link. You can also share this link directly:"
                  : "Share this link with the person you want to invite:"}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                Invite expires in {inviteExpiryLabel}.
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
              onClick={handleClose}
              className="w-full px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-4 mb-4">
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

            <div className="bg-amber-500/10 border border-amber-500/20 p-3 mb-4">
              <p className="text-sm text-amber-400">
                <strong>$15/month</strong> or <strong>$150/year</strong> per member
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Billed to you when they accept. You can remove members anytime.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={inviteMember}
                disabled={!inviteEmail.trim() || loading || parentLoading}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send Invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
