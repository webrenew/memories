"use client";

import { useState } from "react";

export function Quickstart() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const steps = [
    { label: "Install", cmd: "npm install -g @memories.sh/cli" },
    { label: "Init", cmd: "memories init" },
    { label: "Add state", cmd: "memories add --rule 'Use Tailwind for all UI components'" },
    { label: "Recall state", cmd: "memories recall 'styling preferences'" }
  ];

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }).catch(() => {});
  };

  return (
    <section id="quickstart" className="py-28 border-t border-white/5 px-6 lg:px-10">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-20 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="size-2 rounded-full bg-primary animate-pulse" />
            <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">Quick Start</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tighter text-foreground text-gradient">Get Started</h2>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
            Install in seconds. No account required for local use.
          </p>
        </div>

        <div className="glass-panel overflow-hidden relative group mb-12 rounded-lg">
          <div className="flex items-center justify-between px-6 py-4 bg-white/5 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-1.5 h-1.5 bg-primary/60" />
                <div className="w-1.5 h-1.5 bg-primary/60" />
                <div className="w-1.5 h-1.5 bg-primary/60" />
              </div>
              <span className="text-[11px] text-muted-foreground font-mono uppercase tracking-[0.2em] ml-4 font-bold">memories-sh // bash</span>
            </div>
          </div>
          <div className="p-6 md:p-10 font-mono text-sm space-y-6 md:space-y-10 relative z-10">
            {steps.map((step, idx) => (
              <div key={idx} className="group/item relative">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-primary text-[11px] uppercase tracking-[0.2em] font-bold">{step.label}</span>
                  <button 
                    onClick={() => copyToClipboard(step.cmd, idx)}
                    className="opacity-0 group-hover/item:opacity-100 transition-opacity p-1 hover:text-primary"
                  >
                    {copiedIdx === idx ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="flex gap-6 overflow-x-auto">
                  <span className="text-primary/70 selection:bg-transparent">→</span>
                  <span className="text-foreground font-light whitespace-nowrap">{step.cmd}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 md:p-10 glass-panel-soft relative overflow-hidden rounded-lg">
          <div className="absolute top-0 left-0 w-px h-full bg-primary/40" />
          <div className="flex items-start gap-6">
            <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary" />
            <div>
              <h4 className="text-sm font-bold mb-4 tracking-[0.1em] text-foreground uppercase">Two Memory Layers</h4>
              <p className="text-[13px] text-muted-foreground leading-relaxed font-light">
                Memories are stored in two layers of state. <span className="text-primary/90">Global Scope</span> is your persistent state across tools and projects. <span className="text-primary/90">Project Scope</span> is repo-specific, keeping agent context aligned with the current codebase and team rules.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
