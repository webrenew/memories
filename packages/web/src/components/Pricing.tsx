"use client";

import { motion } from "framer-motion";
import { Check } from "@/components/icons/ui";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { useState } from "react";
import { ScrambleText } from "./animations/ScrambleText";

const tiers = [
  {
    name: "Free",
    monthlyPrice: "$0",
    yearlyPrice: "$0",
    description: "Durable state on your machine. No account required.",
    features: [
      "Unlimited local memories",
      "Local semantic recall",
      "13+ tool configs",
      "Built-in MCP server",
      "Works offline by default",
      "Export to JSON/YAML anytime",
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    name: "Professional",
    monthlyPrice: "$15",
    yearlyPrice: "$12.50",
    yearlyTotal: "$150",
    description: "Sync and back up state across machines.",
    features: [
      "Everything in Free",
      "Cloud backup and sync",
      "Access from any device",
      "Web dashboard",
      "Create teams and invite members",
      "Server-side semantic recall",
      "Priority support",
    ],
    cta: "Go Pro",
    highlighted: true,
  },
  {
    name: "Enterprise",
    monthlyPrice: "Custom",
    yearlyPrice: "Custom",
    description: "For teams that need shared state and compliance.",
    features: [
      "Everything in Professional",
      "Custom embedding models",
      "Dedicated support and SLA",
      "SSO and team management",
      "Custom integrations",
      "Volume licensing",
    ],
    cta: "Contact Us",
    highlighted: false,
  },
];

export function Pricing({ user }: { user?: User | null }) {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <section id="pricing" className="py-28 border-t border-border relative overflow-hidden">
      <div className="w-full px-6 lg:px-16 xl:px-24 relative z-10">
        <div className="text-center mb-12">
          <motion.div 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 border border-primary/30 text-[11px] uppercase tracking-[0.25em] font-bold mb-6 text-primary rounded-md"
          >
            <span className="w-1.5 h-1.5 bg-primary animate-pulse" />
            Pricing
          </motion.div>
          <h2 className="font-mono font-normal text-2xl sm:text-4xl mb-6 text-foreground">
            <ScrambleText text="Simple, Transparent Pricing" delayMs={200} />
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg font-light leading-relaxed">
            Free gives you durable local state and recall on your machine. Pro adds sync and backup for that state across every device you work on.
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center gap-3 p-1 bg-background-secondary border border-border rounded-lg">
            <button
              onClick={() => setIsYearly(false)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                !isYearly
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 flex items-center gap-2 ${
                isYearly
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Yearly
              <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary rounded">
                2 Months Free
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {tiers.map((tier) => {
            const price = isYearly ? tier.yearlyPrice : tier.monthlyPrice;
            const isCustom = price === "Custom";
            
            return (
              <div key={tier.name} className={`relative ${tier.highlighted ? "pt-3 -mt-4 mb-[-16px] md:-mt-6 md:mb-[-24px]" : ""}`}>
                {/* Recommended badge — outside overflow-hidden so it's never clipped */}
                {tier.highlighted && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-widest rounded-md z-10">
                    Recommended
                  </div>
                )}

                <div
                  className={`relative flex flex-col h-full p-8 overflow-hidden animate-in fade-in duration-300 ${
                    tier.highlighted 
                      ? "bg-primary/10 ring-1 ring-primary/40 shadow-[0_0_40px_rgba(99,102,241,0.25)]" 
                      : "bg-card/20"
                  } hover:ring-1 hover:ring-primary/40 border border-border shadow-md dark:shadow-[0_16px_50px_rgba(0,0,0,0.35)] rounded-lg`}
                >
                  {/* Background texture and overlay for highlighted card */}
                  {tier.highlighted && (
                    <>
                      <div
                        className="absolute inset-0 opacity-15 dark:opacity-25 bg-cover bg-center bg-no-repeat"
                        style={{ backgroundImage: "url(/bg-texture_memories.webp)" }}
                      />
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            "linear-gradient(135deg, transparent 0%, transparent 5%, var(--background) 25%, var(--background) 75%, transparent 95%, transparent 100%)",
                        }}
                      />
                    </>
                  )}

                  <div className="mb-8 relative z-10">
                    <h3 className="font-mono font-normal text-xl sm:text-2xl mb-2 uppercase tracking-wider text-foreground">{tier.name}</h3>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className="text-4xl font-mono font-bold">{price}</span>
                      {!isCustom && (
                        <span className="text-muted-foreground text-sm">/month</span>
                      )}
                    </div>
                    {isYearly && tier.yearlyTotal && (
                      <div className="text-xs text-muted-foreground mb-3">
                        Billed annually at {tier.yearlyTotal}/year
                      </div>
                    )}
                    {!isYearly && tier.yearlyTotal && (
                      <div className="h-5 mb-3" /> 
                    )}
                    <p className="text-sm text-muted-foreground leading-relaxed italic">
                      {tier.description}
                    </p>
                  </div>

                  <div className="flex-grow mb-10 relative z-10">
                    <div className="text-[11px] uppercase tracking-[0.2em] font-bold text-muted-foreground mb-6">
                      Included Features
                    </div>
                    <ul className="space-y-4">
                      {tier.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-3 text-sm text-muted-foreground">
                          <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Link 
                    href={tier.name === "Enterprise" ? "mailto:hello@memories.sh" : user ? "/app/upgrade" : "/login"}
                    className={`block w-full py-4 text-xs font-bold uppercase tracking-[0.2em] transition-all duration-300 text-center rounded-md relative z-10 ${
                      tier.highlighted
                        ? "bg-primary text-primary-foreground hover:opacity-90 shadow-[0_0_20px_rgba(var(--primary),0.3)]"
                        : "bg-foreground/5 text-foreground border border-border hover:bg-foreground/10"
                    }`}
                  >
                    {tier.cta}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Decorative background elements */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full pointer-events-none opacity-20">
        <div className="absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-border to-transparent" />
        <div className="absolute top-0 left-2/4 w-px h-full bg-gradient-to-b from-transparent via-border to-transparent" />
        <div className="absolute top-0 left-3/4 w-px h-full bg-gradient-to-b from-transparent via-border to-transparent" />
      </div>
    </section>
  );
}
