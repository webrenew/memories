"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { ScrambleText } from "./animations/ScrambleText";

// MCP icon as inline SVG (uses currentColor)
function McpIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M13.85 0a4.16 4.16 0 0 0-2.95 1.217L1.456 10.66a.835.835 0 0 0 0 1.18.835.835 0 0 0 1.18 0l9.442-9.442a2.49 2.49 0 0 1 3.541 0 2.49 2.49 0 0 1 0 3.541L8.59 12.97l-.1.1a.835.835 0 0 0 0 1.18.835.835 0 0 0 1.18 0l.1-.098 7.03-7.034a2.49 2.49 0 0 1 3.542 0l.049.05a2.49 2.49 0 0 1 0 3.54l-8.54 8.54a1.96 1.96 0 0 0 0 2.755l1.753 1.753a.835.835 0 0 0 1.18 0 .835.835 0 0 0 0-1.18l-1.753-1.753a.266.266 0 0 1 0-.394l8.54-8.54a4.185 4.185 0 0 0 0-5.9l-.05-.05a4.16 4.16 0 0 0-2.95-1.218c-.2 0-.401.02-.6.048a4.17 4.17 0 0 0-1.17-3.552A4.16 4.16 0 0 0 13.85 0m0 3.333a.84.84 0 0 0-.59.245L6.275 10.56a4.186 4.186 0 0 0 0 5.902 4.186 4.186 0 0 0 5.902 0L19.16 9.48a.835.835 0 0 0 0-1.18.835.835 0 0 0-1.18 0l-6.985 6.984a2.49 2.49 0 0 1-3.54 0 2.49 2.49 0 0 1 0-3.54l6.983-6.985a.835.835 0 0 0 0-1.18.84.84 0 0 0-.59-.245"/>
    </svg>
  );
}

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
      logo: "mcp", // Special case - use inline SVG
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
            <h2 className="text-4xl md:text-5xl font-bold tracking-tighter text-foreground text-gradient">
              <ScrambleText text="Works With Your Tools" delayMs={200} />
            </h2>
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
                  className="p-8 lg:p-10 bg-card/20 flex flex-col items-start group hover:border-primary/40 transition-all h-full cursor-pointer glass-panel-soft rounded-lg relative"
                >
                  {/* Status badge - top right */}
                  <span className="absolute top-8 right-8 lg:top-10 lg:right-10 text-[10px] font-bold uppercase tracking-[0.25em] px-2 py-0.5 border border-border text-muted-foreground rounded-md">
                    {a.status}
                  </span>
                  
                  {/* Icon - left aligned with headings */}
                  <div className="h-14 mb-12 opacity-80 group-hover:opacity-100 transition-opacity duration-500">
                    {a.logo === "mcp" ? (
                      <McpIcon className="w-10 h-10 text-foreground" />
                    ) : a.logo ? (
                      <Image src={a.logo} alt={a.name} width={40} height={40} className="dark:invert-0 invert" />
                    ) : (
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                        <path d="M4 17l6-6-6-6M12 19h8" />
                      </svg>
                    )}
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
