"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check } from "@/components/icons/ui"
import { toast } from "sonner"

type BillingInterval = "monthly" | "annual"
type CheckoutPlan = "individual" | "team" | "growth"

interface UpgradeCardProps {
  ownerType: "user" | "organization"
  initialPlan?: CheckoutPlan
  initialBilling?: BillingInterval
  autoCheckout?: boolean
}

interface PlanConfig {
  label: string
  monthlyPrice: number
  annualPrice: number
  annualSavingsText: string
  features: string[]
}

const PLAN_CONFIG: Record<CheckoutPlan, PlanConfig> = {
  individual: {
    label: "Individual",
    monthlyPrice: 15,
    annualPrice: 150,
    annualSavingsText: "$12.50/mo billed yearly",
    features: [
      "Cloud sync and backup",
      "Web dashboard access",
      "Cross-device memory access",
      "Priority support",
    ],
  },
  team: {
    label: "Team Seat",
    monthlyPrice: 25,
    annualPrice: 240,
    annualSavingsText: "$20/seat/mo billed yearly",
    features: [
      "Everything in Individual",
      "Per-seat team collaboration",
      "Organization workspace billing",
      "Owner-managed billing controls",
    ],
  },
  growth: {
    label: "Growth",
    monthlyPrice: 299,
    annualPrice: 2870,
    annualSavingsText: "$239.17/mo billed yearly",
    features: [
      "Everything in Team",
      "500 AI SDK projects included / month",
      "$0.05 overage per additional project",
      "Usage-based metering",
    ],
  },
}

export function UpgradeCard({
  ownerType,
  initialPlan,
  initialBilling,
  autoCheckout = false,
}: UpgradeCardProps): React.JSX.Element {
  const availablePlans = useMemo<CheckoutPlan[]>(
    () => (ownerType === "organization" ? ["team", "growth"] : ["individual", "growth"]),
    [ownerType]
  )
  const hasInitialPlan = Boolean(initialPlan && availablePlans.includes(initialPlan))
  const defaultPlan = useMemo<CheckoutPlan>(
    () => (hasInitialPlan ? (initialPlan as CheckoutPlan) : availablePlans[0]),
    [availablePlans, hasInitialPlan, initialPlan]
  )
  const defaultBilling: BillingInterval = initialBilling === "monthly" ? "monthly" : "annual"
  const shouldAutoCheckout = autoCheckout && hasInitialPlan
  const [plan, setPlan] = useState<CheckoutPlan>(defaultPlan)
  const [billing, setBilling] = useState<BillingInterval>(defaultBilling)
  const [loading, setLoading] = useState(false)
  const autoCheckoutTriggeredRef = useRef(false)

  const config = PLAN_CONFIG[plan]
  const amount = billing === "annual" ? config.annualPrice : config.monthlyPrice

  const handleSubscribe = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billing, plan }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to start checkout"
        throw new Error(message)
      }

      const url =
        data && typeof data === "object" && "url" in data && typeof data.url === "string"
          ? data.url
          : null

      if (url) {
        window.location.href = url
      } else {
        throw new Error("Checkout URL was not returned")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start checkout. Please try again.")
      setLoading(false)
    }
  }, [billing, plan])

  useEffect(() => {
    if (!shouldAutoCheckout || autoCheckoutTriggeredRef.current) return
    autoCheckoutTriggeredRef.current = true
    void handleSubscribe()
  }, [handleSubscribe, shouldAutoCheckout])

  return (
    <div className="w-full max-w-sm relative border border-primary/50 bg-primary/5 ring-1 ring-primary/20 p-8">
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-widest">
        {config.label}
      </div>

      <div className="space-y-3 mb-6">
        <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground">Plan</p>
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted/50 border border-border">
          {availablePlans.map((planOption) => {
            const optionLabel = PLAN_CONFIG[planOption].label
            return (
              <button
                key={planOption}
                onClick={() => setPlan(planOption)}
                className={`py-2 text-[10px] uppercase tracking-[0.15em] font-bold transition-all duration-200 ${
                  plan === planOption
                    ? "bg-background text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {optionLabel}
              </button>
            )
          })}
        </div>
      </div>

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
        <span className="text-4xl font-mono font-bold">${amount.toLocaleString()}</span>
        <span className="text-muted-foreground text-sm">/{billing === "annual" ? "year" : "month"}</span>
      </div>
      {billing === "annual" ? (
        <p className="text-xs text-primary font-bold mb-6">{config.annualSavingsText}</p>
      ) : (
        <div className="mb-6" />
      )}

      <ul className="space-y-4 mb-8">
        {config.features.map((feature) => (
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
        {loading ? "Redirecting to Stripe..." : `Subscribe to ${config.label}`}
      </button>
    </div>
  )
}
