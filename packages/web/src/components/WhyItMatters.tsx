"use client";

import { motion } from "framer-motion";

export function WhyItMatters() {
  const cases = [
    {
      title: "No Vendor Lock-in",
      desc: "Switch between Claude Code, Cursor, Copilot, and Windsurf whenever you want. Your rules and context come with you.",
      example: "memories generate windsurf"
    },
    {
      title: "Same Rules, Every Agent",
      desc: "Define your coding standards once. Every tool — new or old — gets the same context automatically.",
      example: "memories generate all"
    },
    {
      title: "Pick Up Where You Left Off",
      desc: "Return to a project after months. Your agent already knows the stack, the decisions, and the why.",
      example: "memories recall 'architecture'"
    }
  ];

  return (
    <section className="py-20 px-6 ">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-3 gap-12 md:gap-24">
          {cases.map((c, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
              className="flex flex-col group"
            >
              <div className="h-px w-12 bg-primary/50 mb-10 group-hover:w-full transition-all duration-700" />
              <h4 className="text-xl font-bold mb-6 tracking-tight text-foreground uppercase tracking-wider">{c.title}</h4>
              <p className="text-[14px] text-muted-foreground leading-relaxed mb-10 font-light">
                {c.desc}
              </p>
              <div className="mt-auto font-mono text-[9px] text-primary/70 uppercase tracking-[0.2em] font-bold group-hover:text-primary transition-colors">
                $ {c.example}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
