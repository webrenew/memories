import React from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { TopNav } from "@/components/TopNav"
import { Footer } from "@/components/Footer"
import { EnterpriseContactForm } from "./enterprise-contact-form"

export const metadata: Metadata = {
  title: "Enterprise Contact",
  description: "Talk to memories.sh about enterprise deployment and usage-based SaaS pricing.",
}

export default function EnterprisePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />

      <main className="pt-28 pb-20 px-6 lg:px-10">
        <div className="w-full px-6 lg:px-16 xl:px-24">
          <div className="max-w-5xl mx-auto">
            <div className="mb-12">
              <div className="inline-flex items-center gap-2 mb-5">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-[12px] uppercase tracking-[0.15em] text-muted-foreground">
                  Enterprise
                </span>
              </div>

              <h1 className="font-mono text-3xl sm:text-5xl tracking-tight mb-4">
                Contact Sales
              </h1>

              <p className="text-muted-foreground text-base sm:text-lg max-w-3xl leading-relaxed">
                Tell us what you are building and we will help you pick the fastest path: self-serve usage-based
                onboarding for dev teams, or enterprise support for larger rollouts.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8 lg:gap-12">
              <div className="border border-border bg-card/20 p-6 sm:p-8 rounded-lg">
                <EnterpriseContactForm />
              </div>

              <aside className="border border-border bg-card/20 p-6 sm:p-8 rounded-lg h-fit">
                <h2 className="font-mono text-xl mb-5">What happens next</h2>
                <ul className="space-y-4 text-sm text-muted-foreground">
                  <li>1. We review your use case and expected scale.</li>
                  <li>2. We suggest a plan with clear ramp pricing.</li>
                  <li>3. We share implementation guidance for SDK + tenant routing.</li>
                </ul>

                <div className="mt-8 pt-6 border-t border-border space-y-3">
                  <p className="text-xs uppercase tracking-[0.18em] font-bold text-muted-foreground">
                    Prefer self-serve?
                  </p>
                  <Link
                    href="/login?next=/app/upgrade"
                    className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    Start on Pro now
                    <span aria-hidden>→</span>
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Start with Pro for immediate access, then move to usage-based/enterprise as traffic grows.
                  </p>
                  <Link
                    href="/docs/sdk"
                    className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Read SDK docs
                    <span aria-hidden>→</span>
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    API contracts, auth model, and rollout examples are in the docs.
                  </p>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
