"use client"

import React, { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"

export function ProvisioningScreen(): React.JSX.Element {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const provisioningRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function provision() {
      // Prevent duplicate calls (React strict mode, fast re-mounts)
      if (provisioningRef.current) return
      provisioningRef.current = true

      try {
        const res = await fetch("/api/db/provision", { method: "POST" })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? "Provisioning failed")
        }

        if (!cancelled) {
          router.refresh()
        }
      } catch (err) {
        if (!cancelled) {
          provisioningRef.current = false
          setError(
            err instanceof Error ? err.message : "Failed to set up database"
          )
        }
      }
    }

    provision()

    return () => {
      cancelled = true
    }
  }, [router])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center mb-6">
          <span className="text-2xl">!</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-3">
          Setup Failed
        </h1>
        <p className="text-muted-foreground max-w-md mb-8 leading-relaxed">
          {error}
        </p>
        <button
          onClick={() => {
            setError(null)
            router.refresh()
          }}
          className="inline-flex items-center gap-3 px-6 py-3 bg-primary text-primary-foreground hover:opacity-90 transition-all duration-300"
        >
          <span className="text-xs font-bold uppercase tracking-[0.15em]">
            Try Again
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-full bg-muted/50 border border-border flex items-center justify-center mb-6">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-3">
        Setting up your database...
      </h1>
      <p className="text-muted-foreground max-w-md leading-relaxed">
        We&apos;re provisioning your cloud database. This only happens once.
      </p>
    </div>
  )
}
