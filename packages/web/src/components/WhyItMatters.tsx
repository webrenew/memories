"use client";

import { motion } from "framer-motion";

export function WhyItMatters() {
  const cases = [
    {
      title: "Works Offline",
      desc: "Everything runs locally — your rules, the database, even semantic search. No internet required.",
      example: "memories search -s 'auth'"
    },
    {
      title: "Switch Tools Anytime",
      desc: "Try Cursor today, Claude Code tomorrow. Your rules generate native configs for 13+ tools.",
      example: "memories generate all"
    },
    {
      title: "Sync When You Need It",
      desc: "Work on multiple machines? Pro syncs your context to the cloud. Everything stays backed up.",
      example: "memories sync enable"
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
