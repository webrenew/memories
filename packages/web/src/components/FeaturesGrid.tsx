"use client";


import Link from "next/link";
import { ScrambleText } from "./animations/ScrambleText";

const FeatureIcon = ({ index }: { index: number }) => {
  const icons = [
    // Durable state - database
    <svg key="tool" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h16M4 14h16M9 6v12M15 6v12" />
    </svg>,
    // Semantic recall - brain/network
    <svg key="context" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M2 12h20M7 7l10 10M17 7L7 17" />
    </svg>,
    // Local embeddings - chip/AI
    <svg key="embed" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
    </svg>,
    // Tool-native output
    <svg key="output" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </svg>,
    // Scoped memory
    <svg key="recall" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
      <path d="M11 7v4l2 2" />
    </svg>,
    // Export/Import
    <svg key="export" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  ];
  return icons[index % icons.length];
};

export function FeaturesGrid() {
  const features = [
    {
      title: "Durable Local State",
      detail: "Rules and context live in a local SQLite store with embeddings, so agent state persists even offline.",
      metric: "Always available",
      docsUrl: "/docs/concepts/memory-types"
    },
    {
      title: "Semantic Recall",
      detail: "Search by meaning, not just keywords. Query 'auth issues' and find JWT validation rules, session handling, and OAuth flows.",
      metric: "768-dim vectors",
      docsUrl: "/docs/cli/recall"
    },
    {
      title: "Local Embeddings",
      detail: "Runs a 100MB embedding model (gte-base) entirely on your CPU via ONNX. No API calls, no data leaves your machine.",
      metric: "100% private",
      docsUrl: "/docs/cli/embed"
    },
    {
      title: "Tool-Native Output",
      detail: "Generate native configs for Cursor, Claude Code, Copilot, Windsurf, Cline, Roo, Gemini, and more.",
      metric: "One command",
      docsUrl: "/docs/cli/generate"
    },
    {
      title: "Scoped Memory",
      detail: "Keep global preferences separate from repo rules, auto-scoped via git remote.",
      metric: "Right context",
      docsUrl: "/docs/concepts/scopes"
    },
    {
      title: "Portable State",
      detail: "Export everything to JSON or YAML anytime. Switch tools or leave entirely. Your data is yours.",
      metric: "No lock-in",
      docsUrl: "/docs/import-export"
    }
  ];

    return (
      <section id="features" className="py-28 border-t border-border relative overflow-hidden">
        {/* Background texture */}
        <div
          className="absolute inset-0 opacity-15 dark:opacity-25 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url(/bg-texture_memories.webp)" }}
        />
        {/* Diamond gradient overlay — opaque center, transparent at TL + BR corners */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, transparent 0%, transparent 5%, var(--background) 25%, var(--background) 75%, transparent 95%, transparent 100%)",
          }}
        />

        <div className="relative w-full px-6 lg:px-16 xl:px-24">
          <div className="mb-20 flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">Core Features</span>
            </div>
            <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground">
              <ScrambleText text="Built for durable state" delayMs={200} />
            </h2>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
              Everything you need to make agent context persist—locally by default, synced when you choose.
            </p>
          </div>
  
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {features.map((f, idx) => (
              <div 
                key={idx}
                className="group p-8 lg:p-10 bg-card/30 border border-border shadow-lg dark:shadow-[0_20px_80px_rgba(0,0,0,0.45)] hover:ring-1 hover:ring-primary/30 relative overflow-hidden rounded-lg"
              >
                <div className="text-primary/60 group-hover:text-primary mb-10">
                  <FeatureIcon index={idx} />
                </div>
                
                <h4 className="text-lg font-bold mb-4 tracking-tight text-foreground">{f.title}</h4>
                <p className="text-[13px] text-muted-foreground leading-relaxed font-light mb-8">
                  {f.detail}
                </p>
                
                <div className="flex items-center justify-between pt-6 border-t border-border">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-primary/60" />
                    <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground">{f.metric}</span>
                  </div>
                  <Link 
                    href={f.docsUrl} 
                    className="text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors"
                  >
                    Learn More →
                  </Link>
                </div>

                {/* Technical Hover Decor */}
                <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none opacity-0 group-hover:opacity-100">
                  <div className="absolute top-4 right-4 w-2 h-2 border-t border-r border-primary/40" />
                </div>
              </div>
            ))}
            
            <div className="group p-8 lg:p-10 bg-primary/10 border border-primary/30 flex flex-col shadow-md dark:shadow-[0_16px_50px_rgba(0,0,0,0.35)] rounded-lg hover:ring-1 hover:ring-primary/40 relative overflow-hidden">
              <div className="text-primary/60 group-hover:text-primary mb-10">
                <div className="w-6 h-6 border border-primary/60 rounded-full flex items-center justify-center">
                  <div className="w-1 h-1 bg-primary animate-pulse" />
                </div>
              </div>
              
              <h4 className="text-lg font-bold tracking-tight text-foreground mb-4">MCP Server</h4>
              <p className="text-[13px] text-muted-foreground leading-relaxed font-light mb-8">
                Built-in Model Context Protocol server with 7 tools so agents can access state directly.
              </p>
              
              <div className="flex items-center justify-between pt-6 border-t border-border">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-primary/60" />
                  <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground">memories serve</span>
                </div>
                <Link 
                  href="/docs/mcp-server" 
                  className="text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors"
                >
                  Learn More →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
}
