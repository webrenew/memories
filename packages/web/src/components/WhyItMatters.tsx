"use client";

import { motion } from "framer-motion";

export function WhyItMatters() {
  const cases = [
    {
      title: "State stays local",
      desc: "Your durable state lives on your machine with rules, database, and recall. Agents keep context even offline.",
      example: "memories recall 'auth'"
    },
    {
      title: "Switch without re-teaching",
      desc: "Generate native configs for 13+ tools so behavior stays consistent when you swap agents.",
      example: "memories generate all"
    },
    {
      title: "Sync state when needed",
      desc: "Pro backs up and syncs state across machines so you can pick up anywhere.",
      example: "memories sync enable"
    }
  ];

  return (
    <section className="py-24 px-6 lg:px-10">
      <div className="max-w-[1400px] mx-auto">
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {cases.map((c, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
              className="flex flex-col group glass-panel-soft p-8 lg:p-10"
            >
              <div className="h-px w-12 bg-primary/70 mb-8 group-hover:w-full transition-all duration-700" />
              <h4 className="text-xl font-bold mb-4 tracking-tight text-foreground uppercase tracking-wider">{c.title}</h4>
              <p className="text-[14px] text-muted-foreground leading-relaxed mb-8 font-light">
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
