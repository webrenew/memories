"use client";

import { motion } from "framer-motion";

const FeatureIcon = ({ index }: { index: number }) => {
  const icons = [
    // Tool-agnostic
    <svg key="tool" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h16M4 14h16M9 6v12M15 6v12" />
    </svg>,
    // Universal context
    <svg key="context" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M2 12h20M7 7l10 10M17 7L7 17" />
    </svg>,
    // Scopes
    <svg key="scopes" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </svg>,
    // Fast recall
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
      metric: "Always available"
    },
    {
      title: "Semantic Recall",
      detail: "Recall related decisions, not just keywords. 'auth issues' finds JWT validation errors.",
      metric: "Consistent behavior"
    },
    {
      title: "Tool-Native Output",
      detail: "Generate native configs for Cursor, Claude Code, Copilot, Windsurf, Cline, Roo, Gemini, and more.",
      metric: "One command"
    },
    {
      title: "Scoped Memory",
      detail: "Keep global preferences separate from repo rules, auto-scoped via git remote.",
      metric: "Right context"
    },
    {
      title: "Portable State",
      detail: "Export everything to JSON or YAML anytime. Switch tools or leave entirely. Your data is yours.",
      metric: "No lock-in"
    }
  ];

    return (
      <section id="features" className="py-28 px-6 lg:px-10">
        <div className="w-full px-6 lg:px-16 xl:px-24">
          <div className="mb-20 flex flex-col items-center text-center">
            <div className="text-[10px] uppercase tracking-[0.35em] font-bold text-primary mb-4">Core Features</div>
            <h2 className="text-4xl md:text-6xl font-bold tracking-tighter text-foreground text-gradient">Built for durable state</h2>
          </div>
  
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-1">
            {features.map((f, idx) => (
              <motion.div 
                key={idx}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
                className="group p-8 lg:p-10 glass-panel hover:border-primary/30 transition-all duration-500 relative overflow-hidden rounded-lg"
              >
                <div className="text-primary/60 group-hover:text-primary transition-colors duration-500 mb-10">
                  <FeatureIcon index={idx} />
                </div>
                
                <h4 className="text-lg font-bold mb-4 tracking-tight text-foreground">{f.title}</h4>
                <p className="text-[13px] text-muted-foreground leading-relaxed font-light mb-8">
                  {f.detail}
                </p>
                
                <div className="flex items-center gap-2 pt-6 border-t border-white/10">
                  <div className="w-1 h-1 rounded-full bg-primary/60" />
                  <span className="text-[9px] uppercase tracking-[0.25em] font-bold text-muted-foreground">{f.metric}</span>
                </div>
  
                {/* Technical Hover Decor */}
                <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-700">
                  <div className="absolute top-4 right-4 w-2 h-2 border-t border-r border-primary/40" />
                </div>
              </motion.div>
            ))}
            
            <div className="p-8 lg:p-10 bg-primary/10 border border-primary/30 flex flex-col justify-between group glass-panel-soft rounded-lg">
              <div>
                <div className="w-6 h-6 border border-primary/60 rounded-full flex items-center justify-center mb-10">
                  <div className="w-1 h-1 bg-primary animate-pulse" />
                </div>
                <h4 className="text-lg font-bold tracking-tight text-foreground mb-2">MCP Server</h4>
                <p className="text-[13px] text-muted-foreground leading-relaxed font-light">
                  Built-in Model Context Protocol server with 7 tools so agents can access state directly.
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary inline-flex items-center gap-2 mt-10">
                memories serve
              </span>
            </div>
          </div>
        </div>
      </section>
    );
}
