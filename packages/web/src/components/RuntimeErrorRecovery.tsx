"use client"

import React, { useEffect } from "react"

const RETRY_KEY = "__memories_chunk_retry_at"
const RETRY_COOLDOWN_MS = 20_000

function readErrorMessage(errorLike: unknown): string {
  if (!errorLike) return ""
  if (typeof errorLike === "string") return errorLike
  if (errorLike instanceof Error) return `${errorLike.name}: ${errorLike.message}`
  if (typeof errorLike === "object" && "message" in errorLike) {
    const message = (errorLike as { message?: unknown }).message
    return typeof message === "string" ? message : ""
  }
  return ""
}

function isChunkLoadFailure(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes("chunkloaderror") ||
    normalized.includes("failed to load chunk") ||
    normalized.includes("loading chunk") ||
    normalized.includes("/_next/static/chunks/")
  )
}

function reloadOnceForChunkError() {
  if (typeof window === "undefined") return

  try {
    const now = Date.now()
    const last = Number(window.sessionStorage.getItem(RETRY_KEY) || "0")
    if (last > 0 && now - last < RETRY_COOLDOWN_MS) {
      return
    }

    window.sessionStorage.setItem(RETRY_KEY, String(now))
    window.location.reload()
  } catch {
    window.location.reload()
  }
}

export function RuntimeErrorRecovery(): React.JSX.Element | null {
  useEffect(() => {
    function onError(event: ErrorEvent) {
      const message = [event.message, readErrorMessage(event.error)].filter(Boolean).join(" ")
      if (isChunkLoadFailure(message)) {
        reloadOnceForChunkError()
      }
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const message = readErrorMessage(event.reason)
      if (isChunkLoadFailure(message)) {
        reloadOnceForChunkError()
      }
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onUnhandledRejection)

    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
    }
  }, [])

  return null
}
