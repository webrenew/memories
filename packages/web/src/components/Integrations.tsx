"use client";

import { motion } from "framer-motion";
import type { JSX } from "react";

const AdapterIcon = ({ name }: { name: string }) => {
  const icons: Record<string, JSX.Element> = {
    "Claude Code": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
    "Cursor": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
      </svg>
    ),
    "GitHub Copilot": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10zM2 12h20" />
      </svg>
    ),
    "Windsurf": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20L9 4M9 4L15 20M15 20L21 4" />
      </svg>
    ),
    "Gemini": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2C12 2 14.5 9.5 22 12C14.5 14.5 12 22 12 22C12 22 9.5 14.5 2 12C9.5 9.5 12 2 12 2Z" />
      </svg>
    ),
    "Any MCP Client": (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 17l6-6-6-6M12 19h8" />
      </svg>
    )
  };
  return icons[name] || <div />;
};

export function Integrations() {
  const adapters = [
    {
      name: "Claude Code",
      status: "Available",
      desc: "Generates CLAUDE.md for Anthropic's coding CLI.",
    },
    {
      name: "Cursor",
      status: "Available",
      desc: "Generates .cursor/rules/memories.mdc with frontmatter.",
    },
    {
      name: "GitHub Copilot",
      status: "Available",
      desc: "Generates .github/copilot-instructions.md.",
    },
    {
      name: "Windsurf",
      status: "Available",
      desc: "Generates .windsurf/rules/memories.md.",
    },
    {
      name: "Gemini",
      status: "Available",
      desc: "Generates GEMINI.md for Google's coding agent.",
    },
    {
      name: "Any MCP Client",
      status: "Available",
      desc: "Built-in MCP server for direct agent access.",
    }
  ];

    return (
      <section id="integrations" className="py-32 px-6 bg-card/5">
        <div className="max-w-6xl mx-auto">
          <div className="mb-24 flex flex-col items-center text-center">
            <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary mb-4">Integrations</div>
            <h2 className="text-4xl md:text-6xl font-bold tracking-tighter text-foreground">Works With Your Tools</h2>
          </div>
  
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-1">
            {adapters.map((a, idx) => (
              <motion.div 
                key={idx}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
                className="p-10 border border-border bg-card/10 flex flex-col items-start group hover:bg-card/20 transition-all"
              >
                <div className="flex items-center justify-between w-full mb-12">
                  <div className="text-primary/60 group-hover:text-primary transition-colors duration-500">
                    <AdapterIcon name={a.name} />
                  </div>
                  <span className="text-[8px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 border border-border text-muted-foreground">
                    {a.status}
                  </span>
                </div>
                
                <h4 className="text-lg font-bold mb-3 tracking-tight text-foreground">{a.name}</h4>
                <p className="text-[13px] text-muted-foreground leading-relaxed mb-10 font-light">{a.desc}</p>
                
                <button className="mt-auto text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-2">
                  View Docs <span className="text-lg opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all">→</span>
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    );
}
