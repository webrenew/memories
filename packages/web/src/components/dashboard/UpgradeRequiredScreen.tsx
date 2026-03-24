import React from "react"
import Link from "next/link"
import { Sparkles } from "@/components/icons/app/Sparkles"

export function UpgradeRequiredScreen(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-full bg-muted/50 border border-border flex items-center justify-center mb-6">
        <Sparkles className="w-7 h-7 text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-3">
        Cloud memory requires a paid plan
      </h1>
      <p className="text-muted-foreground max-w-md mb-8 leading-relaxed">
        Upgrade to get cloud sync, a web dashboard, and access to your memories from any device.
      </p>
      <Link
        href="/app/upgrade"
        className="inline-flex items-center gap-3 px-6 py-3 bg-primary text-primary-foreground hover:opacity-90 transition-all duration-300"
      >
        <span className="text-xs font-bold uppercase tracking-[0.15em]">
          View Plans
        </span>
      </Link>
    </div>
  )
}
