"use client";

import { motion } from "framer-motion";
import { Check } from "@/components/icons/ui";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";

const tiers = [
  {
    name: "Free",
    price: "$0",
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
    price: "$15",
    description: "Sync and back up state across machines.",
    features: [
      "Everything in Free",
      "Cloud backup and sync",
      "Access from any device",
      "Web dashboard",
      "Server-side semantic recall",
      "Priority support",
    ],
    cta: "Go Pro",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For teams that need shared state and compliance.",
    features: [
      "Everything in Professional",
      "Team rule sharing",
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
  return (
    <section id="pricing" className="py-28 px-6 lg:px-10 relative overflow-hidden">
      <div className="w-full px-6 lg:px-16 xl:px-24 relative z-10">
        <div className="text-center mb-20">
          <motion.div 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/30 text-[10px] uppercase tracking-[0.25em] font-bold mb-6 text-primary rounded-md"
          >
            <span className="w-1.5 h-1.5 bg-primary animate-pulse" />
            Pricing
          </motion.div>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-gradient">
            Simple, Transparent <br />
            <span className="text-muted-foreground italic font-light">Pricing</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg font-light leading-relaxed">
            Free gives you durable local state and recall on your machine. Pro adds sync and backup for that state across every device you work on.
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
                className={`relative flex flex-col p-8 ${
                  tier.highlighted 
                    ? "bg-primary/10 ring-1 ring-primary/40 shadow-[0_0_40px_rgba(99,102,241,0.25)]" 
                    : "bg-card/20"
                } transition-all duration-500 hover:border-primary/40 glass-panel-soft rounded-lg`}
              >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-widest rounded-md">
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
                  className={`block w-full py-4 text-xs font-bold uppercase tracking-[0.2em] transition-all duration-300 text-center rounded-md ${
                    tier.highlighted
                      ? "bg-primary text-primary-foreground hover:opacity-90 shadow-[0_0_20px_rgba(var(--primary),0.3)]"
                      : "bg-white/5 text-foreground border border-white/10 hover:bg-white/10"
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
