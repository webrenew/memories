"use client"

import React, { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"

const PROVISION_REQUEST_ID_STORAGE_KEY = "memories:db-provision:request-id"

function getProvisionRequestId(): string {
  if (typeof window === "undefined") {
    return crypto.randomUUID()
  }

  const existing = window.sessionStorage.getItem(PROVISION_REQUEST_ID_STORAGE_KEY)
  if (existing) return existing

  const next = crypto.randomUUID()
  window.sessionStorage.setItem(PROVISION_REQUEST_ID_STORAGE_KEY, next)
  return next
}

function clearProvisionRequestId(): void {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(PROVISION_REQUEST_ID_STORAGE_KEY)
}

export function ProvisioningScreen(): React.JSX.Element {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const provisioningRef = useRef(false)
  const requestIdRef = useRef<string>(getProvisionRequestId())

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function provision() {
      // Prevent duplicate calls (React strict mode, fast re-mounts)
      if (provisioningRef.current) return
      provisioningRef.current = true

      try {
        const res = await fetch("/api/db/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: requestIdRef.current }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? "Provisioning failed")
        }

        clearProvisionRequestId()
        if (!cancelled) {
          router.refresh()
        }
      } catch (err) {
        if (controller.signal.aborted) {
          return
        }
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
      controller.abort()
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
