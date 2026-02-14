"use client"

import React, { useState } from "react"
import { Check } from "@/components/icons/ui"
import { toast } from "sonner"

const features = [
  "Everything in Free",
  "Cloud sync & backup",
  "Web dashboard for browsing memories",
  "Cross-device access",
  "Priority email support",
  "Usage stats and analytics",
]

export function UpgradeCard(): React.JSX.Element {
  const [billing, setBilling] = useState<"monthly" | "annual">("annual")
  const [loading, setLoading] = useState(false)

  async function handleSubscribe() {
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billing }),
      })
      const { url } = await res.json()
      if (url) {
        window.location.href = url
      }
    } catch {
      toast.error("Failed to start checkout. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm relative border border-primary/50 bg-primary/5 ring-1 ring-primary/20 p-8">
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-widest">
        Pro
      </div>

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-1 mb-6 p-1 bg-muted/50 border border-border">
        <button
          onClick={() => setBilling("monthly")}
          className={`flex-1 py-2 text-[10px] uppercase tracking-[0.15em] font-bold transition-all duration-200 ${
            billing === "monthly"
              ? "bg-background text-foreground border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBilling("annual")}
          className={`flex-1 py-2 text-[10px] uppercase tracking-[0.15em] font-bold transition-all duration-200 ${
            billing === "annual"
              ? "bg-background text-foreground border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Annual
        </button>
      </div>

      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-4xl font-mono font-bold">
          {billing === "annual" ? "$150" : "$15"}
        </span>
        <span className="text-muted-foreground text-sm">
          /{billing === "annual" ? "year" : "month"}
        </span>
      </div>
      {billing === "annual" && (
        <p className="text-xs text-primary font-bold mb-6">
          $12.50/mo — save $30/year
        </p>
      )}
      {billing === "monthly" && <div className="mb-6" />}

      <ul className="space-y-4 mb-8">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-sm text-muted-foreground/80">
            <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={handleSubscribe}
        disabled={loading}
        className="w-full py-4 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-[0.2em] hover:opacity-90 transition-all duration-300 disabled:opacity-50"
      >
        {loading ? "Redirecting to Stripe..." : "Subscribe to Pro"}
      </button>
    </div>
  )
}
