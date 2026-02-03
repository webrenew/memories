"use client";

import { motion } from "framer-motion";
import { Check } from "@/components/icons/ui";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";

const tiers = [
  {
    name: "Free",
    price: "$0",
    description: "Full power locally. Switch tools without limits.",
    features: [
      "Unlimited memories",
      "13+ coding agent targets",
      "Full-text search",
      "MCP server for direct agent access",
      "JSON/YAML export & import",
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    name: "Professional",
    price: "$15",
    description: "Sync across machines. Access memories anywhere.",
    features: [
      "Everything in Free",
      "Cloud sync & backup",
      "Web dashboard",
      "Cross-device access",
      "Priority support",
      "Usage analytics",
    ],
    cta: "Go Pro",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For teams with compliance and support needs.",
    features: [
      "Everything in Professional",
      "Dedicated support",
      "SLA guarantees",
      "Team management",
      "Custom integrations",
      "Volume licensing",
    ],
    cta: "Contact Us",
    highlighted: false,
  },
];

export function Pricing({ user }: { user?: User | null }) {
  return (
    <section id="pricing" className="py-24 px-6 relative overflow-hidden">
      <div className="max-w-7xl mx-auto relative z-10">
        <div className="text-center mb-20">
          <motion.div 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3 py-1 bg-primary/5 border border-primary/20 text-[10px] uppercase tracking-[0.2em] font-bold mb-6 text-primary"
          >
            <span className="w-1.5 h-1.5 bg-primary animate-pulse" />
            Pricing
          </motion.div>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Simple, Transparent <br />
            <span className="text-muted-foreground italic font-light">Pricing</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg font-light leading-relaxed">
            Free tier includes everything you need locally. Pro adds cloud sync and cross-device access.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {tiers.map((tier) => (
              <motion.div
                key={tier.name}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
                className={`relative flex flex-col p-8 border ${
                  tier.highlighted 
                    ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" 
                    : "border-border bg-card/20"
                } transition-all duration-500 hover:border-primary/30`}
              >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-widest">
                  Recommended
                </div>
              )}

              <div className="mb-8">
                <h3 className="text-xl font-bold mb-2 uppercase tracking-tight">{tier.name}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-4xl font-mono font-bold">{tier.price}</span>
                  {tier.price !== "Custom" && (
                    <span className="text-muted-foreground text-sm">/month</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed italic">
                  {tier.description}
                </p>
              </div>

              <div className="flex-grow mb-10">
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground mb-6">
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
                  className={`block w-full py-4 text-xs font-bold uppercase tracking-[0.2em] transition-all duration-300 text-center ${
                    tier.highlighted
                      ? "bg-primary text-primary-foreground hover:opacity-90 shadow-[0_0_20px_rgba(var(--primary),0.3)]"
                      : "bg-muted/50 text-foreground border border-border hover:bg-muted"
                  }`}
                >
                  {tier.cta}
                </Link>
              </motion.div>
            ))}
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
