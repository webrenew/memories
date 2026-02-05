"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

export function Integrations() {
  const adapters = [
    {
      name: "Claude Code",
      logo: "/logos/claude-code.svg",
      status: "Available",
      desc: "Generates CLAUDE.md for Anthropic's coding CLI.",
      docsUrl: "/docs/integrations/claude-code",
    },
    {
      name: "Cursor",
      logo: "/logos/cursor.svg",
      status: "Available",
      desc: "Generates .cursor/rules/memories.mdc with frontmatter.",
      docsUrl: "/docs/integrations/cursor",
    },
    {
      name: "GitHub Copilot",
      logo: "/logos/copilot.svg",
      status: "Available",
      desc: "Generates .github/copilot-instructions.md.",
      docsUrl: "/docs/integrations/copilot",
    },
    {
      name: "Windsurf",
      logo: "/logos/windsurf.svg",
      status: "Available",
      desc: "Generates .windsurf/rules/memories.md.",
      docsUrl: "/docs/integrations/windsurf",
    },
    {
      name: "Gemini",
      logo: "/logos/gemini.svg",
      status: "Available",
      desc: "Generates GEMINI.md for Google's coding agent.",
      docsUrl: "/docs/integrations/gemini",
    },
    {
      name: "Any MCP Client",
      logo: "/logos/mcp.svg",
      status: "Available",
      desc: "Built-in MCP server for direct agent access.",
      docsUrl: "/docs/integrations/mcp",
    }
  ];

    return (
      <section id="integrations" className="py-28 border-t border-border">
        <div className="w-full px-6 lg:px-16 xl:px-24">
          <div className="mb-20 flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">Integrations</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tighter text-foreground text-gradient">Works With Your Tools</h2>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
              One memory store, every coding agent. Generate native config files for each tool so your context follows you—no copy-paste, no manual sync.
            </p>
          </div>
  
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {adapters.map((a, idx) => (
              <Link href={a.docsUrl} key={idx}>
                <motion.div 
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4 }}
                  className="p-8 lg:p-10 bg-card/20 flex flex-col items-start group hover:border-primary/40 transition-all h-full cursor-pointer glass-panel-soft rounded-lg"
                >
                  <div className="flex items-center justify-between w-full mb-12">
                    <div className="w-14 h-14 flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity duration-500">
                      {a.logo ? (
                        <Image src={a.logo} alt={a.name} width={56} height={56} className="dark:invert-0 invert" />
                      ) : (
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                          <path d="M4 17l6-6-6-6M12 19h8" />
                        </svg>
                      )}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.25em] px-2 py-0.5 border border-border text-muted-foreground rounded-md">
                      {a.status}
                    </span>
                  </div>
                  
                  <h4 className="text-lg font-bold mb-3 tracking-tight text-foreground">{a.name}</h4>
                  <p className="text-[13px] text-muted-foreground leading-relaxed mb-10 font-light">{a.desc}</p>
                  
                  <span className="mt-auto text-[11px] font-bold uppercase tracking-[0.25em] text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-2">
                    View Docs <span className="text-lg opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all">→</span>
                  </span>
                </motion.div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    );
}
