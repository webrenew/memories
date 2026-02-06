"use client";


import Image from "next/image";
import Link from "next/link";
import { ScrambleText } from "./animations/ScrambleText";

export function Integrations() {
  const adapters = [
    {
      name: "Claude Code",
      logo: "/logos/claude-code.svg",
      status: "Available",
      desc: "Generates CLAUDE.md, path-scoped rules, skills, and settings.",
      docsUrl: "/docs/integrations/claude-code",
    },
    {
      name: "Cursor",
      logo: "/logos/cursor.svg",
      status: "Available",
      desc: "Generates .cursor/rules/ with globs frontmatter and skills.",
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
            <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground">
              <ScrambleText text="Works With Your Tools" delayMs={200} />
            </h2>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
              One memory store, every coding agent. Generate native config files for each tool so your context follows you—no copy-paste, no manual sync.
            </p>
          </div>
  
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {adapters.map((a, idx) => (
              <Link href={a.docsUrl} key={idx}>
                <div className="p-8 lg:p-10 bg-card/20 flex flex-col items-start group hover:ring-1 hover:ring-primary/40 h-full cursor-pointer border border-border shadow-md dark:shadow-[0_16px_50px_rgba(0,0,0,0.35)] rounded-lg relative overflow-hidden">
                  {/* Background texture - visible on hover */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-20 dark:group-hover:opacity-40 bg-cover bg-center bg-no-repeat"
                    style={{ backgroundImage: "url(/bg-texture_memories.webp)" }}
                  />
                  {/* Diamond gradient overlay - visible on hover */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-60 dark:group-hover:opacity-50"
                    style={{
                      background:
                        "linear-gradient(135deg, transparent 0%, transparent 10%, var(--background) 35%, var(--background) 65%, transparent 90%, transparent 100%)",
                    }}
                  />

                  {/* Status badge - top right */}
                  <span className="absolute top-8 right-8 lg:top-10 lg:right-10 text-[10px] font-bold uppercase tracking-[0.25em] px-2 py-0.5 border border-border text-muted-foreground rounded-md z-10">
                    {a.status}
                  </span>
                  
                  {/* Icon - left aligned with headings */}
                  <div className="h-14 mb-12 opacity-80 group-hover:opacity-100 relative z-10">
                    {a.logo ? (
                      <Image src={a.logo} alt={a.name} width={40} height={40} className="dark:invert-0 invert" />
                    ) : (
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                        <path d="M4 17l6-6-6-6M12 19h8" />
                      </svg>
                    )}
                  </div>
                  
                  <h4 className="text-lg font-bold mb-3 tracking-tight text-foreground relative z-10">{a.name}</h4>
                  <p className="text-[13px] text-muted-foreground leading-relaxed mb-10 font-light relative z-10">{a.desc}</p>
                  
                  <span className="mt-auto text-[11px] font-bold uppercase tracking-[0.25em] text-muted-foreground group-hover:text-primary flex items-center gap-2 relative z-10">
                    View Docs <span className="text-lg opacity-0 group-hover:opacity-100 group-hover:translate-x-1">→</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    );
}
