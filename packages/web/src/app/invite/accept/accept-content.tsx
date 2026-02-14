"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Users, ArrowRight, AlertTriangle } from "lucide-react"

interface AcceptInviteContentProps {
  token: string
  orgName: string
  role: string
  email: string
  isLoggedIn: boolean
  userEmails: string[]
}

export function AcceptInviteContent({ 
  token, 
  orgName, 
  role, 
  email,
  isLoggedIn,
  userEmails 
}: AcceptInviteContentProps): React.JSX.Element {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inviteEmailLower = email.toLowerCase()
  const hasMatchingEmail = userEmails.some(e => e.toLowerCase() === inviteEmailLower)
  const emailMismatch = isLoggedIn && !hasMatchingEmail

  async function acceptInvite() {
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })

      const data = await res.json()

      if (res.ok) {
        router.push("/app/team")
      } else {
        setError(data.error || "Failed to accept invite")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="memory-lattice" />
      
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <Image
              src="/memories.svg"
              alt="memories.sh"
              width={32}
              height={32}
              className="dark:invert"
            />
            <span className="font-mono text-sm font-bold tracking-tighter uppercase">
              memories.sh
            </span>
          </Link>
        </div>

        <div className="border border-border bg-card/20 p-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Users className="h-8 w-8 text-primary" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-center mb-2">
            Join {orgName}
          </h1>
          <p className="text-center text-muted-foreground mb-6">
            You&apos;ve been invited to join as a <span className="font-medium capitalize">{role}</span>
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 p-3 mb-6 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!isLoggedIn ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                Sign in with <span className="font-medium text-foreground">{email}</span> to accept this invite.
              </p>
              <Link
                href={`/login?redirect=/invite/accept?token=${token}`}
                className="flex items-center justify-center gap-2 w-full py-3 bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                Sign In to Continue
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : emailMismatch ? (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 p-3">
                <p className="text-sm text-amber-400">
                  This invite was sent to <span className="font-medium">{email}</span>, 
                  but your account is linked to: <span className="font-medium">{userEmails.join(", ")}</span>.
                </p>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Link <span className="font-medium">{email}</span> to your account by signing in with it, or sign out to use a different account.
              </p>
              <a
                href={`/login?redirect=/invite/accept?token=${token}&link=true`}
                className="flex items-center justify-center gap-2 w-full py-3 bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                Link {email}
                <ArrowRight className="h-4 w-4" />
              </a>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="w-full py-3 border border-border hover:bg-muted/50 font-medium transition-colors"
                >
                  Sign Out Instead
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                {userEmails.length > 0 && (
                  <>
                    Signed in as <span className="font-medium text-foreground">{userEmails[0]}</span>
                    {userEmails.length > 1 && (
                      <span className="text-xs text-muted-foreground/60"> (+{userEmails.length - 1} linked)</span>
                    )}
                  </>
                )}
              </p>
              <button
                onClick={acceptInvite}
                disabled={loading}
                className="flex items-center justify-center gap-2 w-full py-3 bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Joining..." : "Accept Invite"}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          By joining, you agree to our{" "}
          <Link href="/terms" className="underline hover:text-foreground transition-colors">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
