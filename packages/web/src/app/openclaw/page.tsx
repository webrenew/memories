import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Database,
  FileCode2,
  FolderSync,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { TopNav } from "@/components/TopNav";
import { Footer } from "@/components/Footer";
import { ScrambleText } from "@/components/animations/ScrambleText";
import { OpenClawHeroBackground } from "@/components/openclaw/HeroBackground";
import { OpenClawHeroIllustration } from "@/components/openclaw/HeroIllustration";
import { OpenClawSetupCommandSequence } from "@/components/openclaw/SetupCommandSequence";

export const metadata: Metadata = {
  title: "OpenClaw Memory Landing Page",
  description:
    "How memories.sh solves OpenClaw's memory problem by keeping the full workspace contract synced, searchable, and reusable across tools.",
  openGraph: {
    title: "How memories.sh solves OpenClaw's memory problem",
    description:
      "Workspace-first OpenClaw integration with durable memory, portable rules, and repeatable sync workflows.",
    url: "https://memories.sh/openclaw",
    type: "website",
  },
};

const solvePillars = [
  {
    title: "Workspace contract sync",
    detail:
      "Carry OpenClaw's workspace files as one versioned set, not ad-hoc edits scattered across machines.",
    metric: "AGENTS + SOUL + TOOLS + memory/**",
  },
  {
    title: "Structured local memory",
    detail:
      "Store rules, facts, and decisions in one searchable database so context is durable between sessions.",
    metric: "SQLite + semantic recall",
  },
  {
    title: "Cross-agent portability",
    detail:
      "Keep OpenClaw behavior and reuse it in Claude Code, Cursor, Windsurf, and other integrations.",
    metric: "One source of truth",
  },
  {
    title: "Skill reuse",
    detail:
      "Generate `.agents/skills/**/SKILL.md` and sync into OpenClaw workspace `skills/` with predictable structure.",
    metric: "No manual skill rewrites",
  },
  {
    title: "Safe config sync",
    detail:
      "Include `~/.openclaw/openclaw.json` when needed while redacting secret-like fields from stored files.",
    metric: "--include-config support",
  },
  {
    title: "Repeatable maintenance loop",
    detail:
      "Regenerate and re-apply workspace artifacts whenever memories change, so runtime instructions stay aligned.",
    metric: "Automatable refresh cycle",
  },
];

const workspaceFiles = [
  "~/.openclaw/workspace/AGENTS.md",
  "~/.openclaw/workspace/SOUL.md",
  "~/.openclaw/workspace/TOOLS.md",
  "~/.openclaw/workspace/IDENTITY.md",
  "~/.openclaw/workspace/USER.md",
  "~/.openclaw/workspace/HEARTBEAT.md",
  "~/.openclaw/workspace/BOOTSTRAP.md",
  "~/.openclaw/workspace/MEMORY.md or memory.md",
  "~/.openclaw/workspace/memory/*.md",
  "~/.openclaw/workspace/skills/**/*",
];

const faqs = [
  {
    q: "What exactly is the OpenClaw memory problem?",
    a: "OpenClaw relies on a full workspace pack, not one file. As that pack changes across sessions and machines, behavior drifts. memories.sh keeps those instructions and skills synchronized from a durable memory source.",
  },
  {
    q: "Is this AGENTS.md only?",
    a: "No. The recommended workflow is workspace-first and includes AGENTS, SOUL, TOOLS, IDENTITY, USER, HEARTBEAT, BOOTSTRAP, memory files, and skills.",
  },
  {
    q: "Does this replace OpenClaw onboarding?",
    a: "No. Run `openclaw onboard` first so OpenClaw creates its workspace. Then memories.sh generates and syncs updates into that workspace.",
  },
  {
    q: "Can I keep OpenClaw memory aligned with other agents?",
    a: "Yes. memories.sh stores memory once and generates outputs for multiple integrations, so decisions and rules stay consistent when you switch tools.",
  },
];

export default function OpenClawPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      <TopNav />

      <main className="relative text-[15px] leading-7">
        <section id="overview" className="relative min-h-screen overflow-hidden border-b border-border pt-24 pb-16">
          <OpenClawHeroBackground />

          <div className="relative z-10 flex w-full min-h-[calc(100vh-160px)] items-center px-6 lg:px-16 xl:px-24">
            <div className="grid w-full items-center gap-12 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16">
              <div className="flex flex-col items-start text-left">
                <div className="mb-6 inline-flex items-center gap-2">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                  <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                    OpenClaw Integration
                  </span>
                </div>

                <h1 className="mb-6 font-mono text-3xl leading-[0.95] tracking-tight text-foreground sm:text-4xl lg:text-5xl xl:text-6xl">
                  <ScrambleText text="How memories.sh solves OpenClaw's memory problem." delayMs={220} duration={0.9} />
                </h1>

                <p className="mb-8 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
                  OpenClaw runs on a workspace pack, not a single instruction file. memories.sh keeps that full pack synced,
                  searchable, and portable across tools so behavior stays stable over time.
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href="/docs/integrations/openclaw"
                    className="group inline-flex items-center px-5 py-2 bg-primary/90 text-primary-foreground shadow-[0_0_30px_rgba(99,102,241,0.25)] hover:opacity-90 transition-all duration-300 rounded-md"
                  >
                    <span className="text-[10px] uppercase tracking-[0.2em] font-bold">OpenClaw Setup Guide</span>
                    <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Link>
                  <Link
                    href="/openclaw/resources"
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-card/30 px-5 py-2 text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Resource Guide
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <a
                    href="/openclaw/llms.txt"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-card/20 px-5 py-2 text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                  >
                    For Agents (llms.txt)
                    <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              <OpenClawHeroIllustration />
            </div>
          </div>
        </section>

        <section id="how-it-works" className="relative py-32 lg:py-44 border-y border-border bg-background-secondary">
          <div className="w-full px-6 lg:px-16 xl:px-24">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 xl:gap-24">
              <div className="min-w-0 flex flex-col items-start text-left">
                <div className="inline-flex items-center gap-2 mb-6">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                    How It Works
                  </span>
                </div>
                <h2 className="font-mono font-normal text-2xl sm:text-4xl tracking-tight text-foreground mb-4">
                  <ScrambleText text="Workspace-first memory pipeline for OpenClaw." delayMs={120} duration={0.8} />
                </h2>
                <p className="text-base sm:text-lg text-muted-foreground max-w-md leading-relaxed">
                  The sequence is simple: onboard OpenClaw once, generate workspace artifacts from memories, then keep
                  the workspace synced as your memory base evolves.
                </p>
              </div>

              <div className="min-w-0">
                <div className="mb-5 flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-primary" />
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Recommended flow</span>
                </div>
                <OpenClawSetupCommandSequence />
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="py-28 border-t border-border relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-15 dark:opacity-25 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: "url(/bg-texture_memories.webp)" }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, transparent 0%, transparent 5%, var(--background) 25%, var(--background) 75%, transparent 95%, transparent 100%)",
            }}
          />

          <div className="relative w-full px-6 lg:px-16 xl:px-24">
            <div className="mb-20 flex max-w-3xl flex-col items-start text-left">
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                  Why It Solves It
                </span>
              </div>
              <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground">
                <ScrambleText text="Memory stability for OpenClaw at operational depth." delayMs={180} />
              </h2>
              <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl leading-relaxed">
                memories.sh addresses root causes of OpenClaw memory drift: fragmented files, manual sync, and
                tool-specific lock-in.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {solvePillars.map((pillar, idx) => (
                <div
                  key={pillar.title}
                  className="group p-8 lg:p-10 bg-card/30 border border-border shadow-lg dark:shadow-[0_20px_80px_rgba(0,0,0,0.45)] hover:ring-1 hover:ring-primary/30 relative overflow-hidden rounded-lg"
                >
                  <div className="mb-10 text-primary/60 group-hover:text-primary">
                    {idx % 3 === 0 && <FolderSync className="h-6 w-6" />}
                    {idx % 3 === 1 && <Database className="h-6 w-6" />}
                    {idx % 3 === 2 && <Sparkles className="h-6 w-6" />}
                  </div>

                  <h4 className="text-lg font-bold mb-4 tracking-tight text-foreground">{pillar.title}</h4>
                  <p className="text-[13px] text-muted-foreground leading-relaxed font-light mb-8">{pillar.detail}</p>

                  <div className="flex items-center gap-2 pt-6 border-t border-border">
                    <div className="w-1 h-1 rounded-full bg-primary/60" />
                    <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground">{pillar.metric}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="api" className="py-28 border-t border-border relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-20"
            style={{
              background:
                "radial-gradient(circle at 12% 18%, rgba(99,102,241,0.25), transparent 30%), radial-gradient(circle at 88% 78%, rgba(16,185,129,0.15), transparent 32%)",
            }}
          />
          <div className="relative w-full px-6 lg:px-16 xl:px-24">
            <div className="mb-20 flex max-w-3xl flex-col items-start text-left">
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                  Command Pattern
                </span>
              </div>
              <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground">
                <ScrambleText text="Repeatable sync loop instead of manual drift fixes." delayMs={200} />
              </h2>
              <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-3xl leading-relaxed">
                Run this when memories change to keep OpenClaw workspace instructions and skills aligned with your latest state.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] items-start">
              <div className="grid gap-2">
                <div className="px-4 py-4 border rounded-lg border-primary/50 bg-primary/10 shadow-[0_0_30px_rgba(99,102,241,0.15)]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold tracking-tight text-foreground">Sync OpenClaw workspace</span>
                    <span className="px-2 py-0.5 border rounded font-mono text-[10px] text-sky-200 border-sky-300/30 bg-sky-500/10">
                      CLI
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground break-all">/docs/integrations/openclaw</p>
                </div>
                <div className="px-4 py-4 border rounded-lg border-border bg-card/20">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Config-safe sync</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Use <code className="font-mono text-foreground/80">--include-config</code> when you need OpenClaw runtime
                    config synced too.
                  </p>
                </div>
              </div>

              <div className="border border-border rounded-xl bg-card/20 overflow-hidden">
                <div className="px-5 py-4 border-b border-border bg-foreground/[0.03]">
                  <div className="flex items-center gap-3">
                    <FileCode2 className="h-4 w-4 text-primary" />
                    <code className="font-mono text-xs text-foreground/90 break-all">openclaw-memory-refresh.sh</code>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Canonical refresh workflow for OpenClaw workspace instructions and skills.
                  </p>
                </div>
                <div className="p-5">
                  <pre className="overflow-hidden rounded-lg border border-border bg-background px-4 py-3 text-[11px] leading-relaxed">
                    <code className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
{`cd your-project
memories generate claude -o ~/.openclaw/workspace/AGENTS.md --force
memories generate agents
if [ -d .agents/skills ]; then
  cp -R .agents/skills/. ~/.openclaw/workspace/skills/
fi

memories files ingest --global --include-config
memories files apply --global --include-config --force`}
                    </code>
                  </pre>
                </div>
              </div>
            </div>

            <div className="mt-14 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/integrations/openclaw"
                className="inline-flex items-center gap-2 px-4 py-2 border border-primary/40 bg-primary/10 text-primary text-xs uppercase tracking-[0.16em] font-bold hover:bg-primary/20 transition-colors rounded-md"
              >
                Read OpenClaw Integration
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/docs/cli/files"
                className="inline-flex items-center gap-2 px-4 py-2 border border-border bg-card/30 text-muted-foreground text-xs uppercase tracking-[0.16em] font-bold hover:text-foreground hover:border-primary/30 transition-colors rounded-md"
              >
                File Sync Docs
              </Link>
            </div>
          </div>
        </section>

        <section id="integrations" className="py-28 border-t border-border">
          <div className="w-full px-6 lg:px-16 xl:px-24">
            <div className="mb-20 flex max-w-3xl flex-col items-start text-left">
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                  OpenClaw Workspace Coverage
                </span>
              </div>
              <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground">
                <ScrambleText text="The file set that memories.sh keeps coherent." delayMs={200} />
              </h2>
              <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl leading-relaxed">
                OpenClaw's workspace is a contract. This is the high-value set that memories.sh can ingest and apply so runtime behavior does not fragment.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {workspaceFiles.map((file) => (
                <div
                  key={file}
                  className="p-8 lg:p-10 bg-card/20 flex flex-col items-start border border-border shadow-md dark:shadow-[0_16px_50px_rgba(0,0,0,0.35)] rounded-lg relative overflow-hidden"
                >
                  <div className="absolute inset-0 opacity-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: "url(/bg-texture_memories.webp)" }} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-muted-foreground mb-6">
                    Synced
                  </span>
                  <code className="text-[13px] text-foreground/90 break-all leading-relaxed font-mono">{file}</code>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="py-28 px-6 lg:px-16 xl:px-24 border-t border-white/10">
          <div className="max-w-[1000px] mx-auto">
            <div className="mb-20 flex max-w-3xl flex-col items-start text-left">
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                  FAQ
                </span>
              </div>
              <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground">
                <ScrambleText text="OpenClaw memory integration, answered." delayMs={200} />
              </h2>
              <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl leading-relaxed">
                Practical answers for implementing and maintaining memories.sh with OpenClaw.
              </p>
            </div>

            <div className="space-y-1">
              {faqs.map((item) => (
                <div key={item.q} className="glass-panel-soft rounded-lg bg-card/20 p-10">
                  <h3 className="font-mono font-normal tracking-tight text-lg text-foreground mb-4">{item.q}</h3>
                  <p className="text-[14px] text-muted-foreground leading-relaxed font-light">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
