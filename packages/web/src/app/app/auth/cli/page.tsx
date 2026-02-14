"use client"

import { useSearchParams } from "next/navigation"
import React, { useState, Suspense } from "react"

function CLIAuthContent() {
  const searchParams = useSearchParams()
  const code = searchParams.get("code")
  const [status, setStatus] = useState<"pending" | "approving" | "done" | "error">("pending")

  async function handleApprove() {
    if (!code) return
    setStatus("approving")

    try {
      const res = await fetch("/api/auth/cli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", code }),
      })

      if (!res.ok) {
        throw new Error("Failed to approve")
      }

      setStatus("done")
    } catch {
      setStatus("error")
    }
  }

  if (!code) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-2xl font-bold tracking-tight mb-3">
          Invalid Link
        </h1>
        <p className="text-muted-foreground max-w-md">
          This link is missing the authorization code. Run{" "}
          <code className="px-2 py-0.5 bg-muted border border-border font-mono text-xs">
            memories login
          </code>{" "}
          again to generate a new one.
        </p>
      </div>
    )
  }

  if (status === "done") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
          <span className="text-2xl text-primary">&#10003;</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-3">
          CLI Authorized
        </h1>
        <p className="text-muted-foreground max-w-md">
          You can close this tab and return to your terminal.
        </p>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-2xl font-bold tracking-tight mb-3">
          Authorization Failed
        </h1>
        <p className="text-muted-foreground max-w-md mb-8">
          Something went wrong. Please try running{" "}
          <code className="px-2 py-0.5 bg-muted border border-border font-mono text-xs">
            memories login
          </code>{" "}
          again.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <h1 className="text-2xl font-bold tracking-tight mb-3">
        Authorize CLI
      </h1>
      <p className="text-muted-foreground max-w-md mb-8 leading-relaxed">
        The <code className="px-2 py-0.5 bg-muted border border-border font-mono text-xs">memories</code> CLI
        is requesting access to your account.
      </p>
      <button
        onClick={handleApprove}
        disabled={status === "approving"}
        className="px-8 py-3 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-[0.15em] hover:opacity-90 transition-all duration-300 disabled:opacity-50"
      >
        {status === "approving" ? "Authorizing..." : "Approve"}
      </button>
    </div>
  )
}

export default function CLIAuthPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <CLIAuthContent />
    </Suspense>
  )
}
