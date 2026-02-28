import React from "react";
import Link from "next/link";

const memoryLanes = [
  {
    name: "Session",
    purpose: "Active working context for the current task.",
    store: "Session events, checkpoints, boundary snapshots.",
    retrieval: "Used first for continuity in ongoing work.",
  },
  {
    name: "Semantic",
    purpose: "Durable truths and stable project knowledge.",
    store: "Rules, facts, decisions, `memory.md` in OpenClaw mode.",
    retrieval: "Always-on grounding for consistent behavior.",
  },
  {
    name: "Episodic",
    purpose: "Timeline fidelity for what happened and when.",
    store: "Daily logs + raw session snapshots.",
    retrieval: "Chronology and context history on demand.",
  },
  {
    name: "Procedural",
    purpose: "Repeatable workflow memory and runbooks.",
    store: "Skill-like workflows and promotion signals.",
    retrieval: "Prioritized when intent matches a workflow.",
  },
];

const triggerModes = [
  {
    label: "Count Trigger",
    detail: "Near token/turn budget boundaries",
  },
  {
    label: "Time Trigger",
    detail: "Session inactivity compaction windows",
  },
  {
    label: "Event Trigger",
    detail: "Reset, handoff, or task-complete boundaries",
  },
];

export function MemorySegmentationSection(): React.JSX.Element {
  return (
    <section id="memory-segmentation" className="relative overflow-hidden border-y border-border py-28">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(circle at 18% 22%, rgba(99,102,241,0.18), transparent 40%), radial-gradient(circle at 82% 78%, rgba(16,185,129,0.12), transparent 42%)",
        }}
      />
      <div className="relative w-full px-6 lg:px-16 xl:px-24">
        <div className="mb-14 max-w-4xl">
          <div className="mb-4 inline-flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="font-mono text-[12px] uppercase tracking-[-0.015rem] text-muted-foreground">
              Memory Segmentation
            </span>
          </div>
          <h2 className="font-mono text-2xl sm:text-4xl text-foreground">
            One memory system. Four distinct lanes.
          </h2>
          <p className="mt-6 max-w-3xl text-base sm:text-lg leading-relaxed text-muted-foreground">
            This is the core model behind memories.sh. Session, semantic, episodic, and procedural memory are stored
            separately so agents keep continuity without blending durable truths with transient chat history.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {memoryLanes.map((lane) => (
            <article
              key={lane.name}
              className="rounded-lg border border-border bg-card/40 p-6 shadow-lg shadow-black/10 backdrop-blur-sm"
            >
              <h3 className="font-mono text-sm uppercase tracking-[0.2em] text-primary">{lane.name}</h3>
              <p className="mt-4 text-sm text-foreground/90">{lane.purpose}</p>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                <span className="text-foreground/80">Stored:</span> {lane.store}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                <span className="text-foreground/80">Recall:</span> {lane.retrieval}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 rounded-xl border border-border bg-card/30 p-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-accent-secondary" />
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Compaction Triggers
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {triggerModes.map((mode) => (
              <div key={mode.label} className="rounded-md border border-border bg-background/50 px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground">{mode.label}</p>
                <p className="mt-2 text-xs text-muted-foreground">{mode.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/docs/concepts/memory-segmentation"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-xs font-mono uppercase tracking-[0.15em] text-foreground transition-colors hover:bg-muted"
          >
            Read Segmentation Docs
          </Link>
          <Link
            href="/docs/cli/session"
            className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-mono uppercase tracking-[0.15em] text-primary transition-colors hover:bg-primary/15"
          >
            Explore Session Commands
          </Link>
        </div>
      </div>
    </section>
  );
}
