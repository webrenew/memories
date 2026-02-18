import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { TopNav } from "@/components/TopNav";
import { Footer } from "@/components/Footer";
import { ScrambleText } from "@/components/animations/ScrambleText";

export const metadata: Metadata = {
  title: "OpenClaw Resource Guide",
  description:
    "Task-focused OpenClaw resource map for setup, security hardening, workspace sync, providers, skills, and troubleshooting.",
  openGraph: {
    title: "OpenClaw Resource Guide",
    description:
      "A practical guide map for running OpenClaw with stable memory workflows powered by memories.sh.",
    url: "https://memories.sh/openclaw/resources",
    type: "website",
  },
};

const officialReferences = [
  { label: "OpenClaw Integration (memories docs)", href: "/docs/integrations/openclaw", internal: true },
  { label: "OpenClaw Docs Home", href: "https://docs.openclaw.ai/" },
  { label: "OpenClaw Onboarding", href: "https://docs.openclaw.ai/start/onboarding" },
  { label: "OpenClaw Agent Workspace", href: "https://docs.openclaw.ai/concepts/agent-workspace" },
  { label: "Gateway Security", href: "https://docs.openclaw.ai/gateway/security" },
  { label: "OpenClaw Releases", href: "https://github.com/openclaw/openclaw/releases" },
];

const tracks = [
  {
    title: "Track 1: First Stable Install",
    pages: [
      "Run OpenClaw onboarding and validate workspace path",
      "Generate AGENTS + skills from memories.sh",
      "Verify workspace files are applied and read by OpenClaw",
    ],
  },
  {
    title: "Track 2: Memory Drift Prevention",
    pages: [
      "Use files ingest/apply for OpenClaw workspace set",
      "Include runtime config safely with --include-config when required",
      "Set refresh cadence after major rule/skill updates",
    ],
  },
  {
    title: "Track 3: Security and Reliability",
    pages: [
      "Pairing and allowlist baseline before broad channel exposure",
      "Provider and gateway auth checks after sync changes",
      "Runbook for no-response and auth failure scenarios",
    ],
  },
  {
    title: "Track 4: Cross-Agent Portability",
    pages: [
      "Reuse OpenClaw rule set in Claude Code/Cursor/Windsurf",
      "Standardize skill definitions across ecosystems",
      "Use one memory source for multi-agent consistency",
    ],
  },
];

export default function OpenClawResourcesPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      <TopNav />

      <main className="relative text-[15px] leading-7">
        <section className="relative border-b border-border pt-24 pb-16">
          <div
            className="absolute inset-0 opacity-20"
            style={{
              background:
                "radial-gradient(circle at 18% 20%, rgba(99,102,241,0.28), transparent 36%), radial-gradient(circle at 84% 16%, rgba(236,72,153,0.22), transparent 34%)",
            }}
          />
          <div className="relative w-full px-6 lg:px-16 xl:px-24">
            <Link
              href="/openclaw"
              className="mb-8 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground"
            >
              <ArrowRight className="h-3.5 w-3.5 rotate-180" />
              Back to OpenClaw landing page
            </Link>

            <div className="mb-6 inline-flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                Resource Guide
              </span>
            </div>

            <h1 className="max-w-4xl font-mono text-3xl leading-[0.95] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              <ScrambleText text="OpenClaw + memories.sh implementation map." delayMs={160} duration={0.8} />
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Use this guide to move from first install to stable operations. The structure mirrors the real OpenClaw
              memory problem: workspace drift, inconsistent skill sync, and fragmented context between tools.
            </p>
          </div>
        </section>

        <section id="references" className="py-28 border-t border-border relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-15 dark:opacity-25 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: "url(/bg-texture_memories.webp)" }}
          />
          <div className="relative w-full px-6 lg:px-16 xl:px-24">
            <div className="mb-20 flex max-w-3xl flex-col items-start text-left">
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                  Official References
                </span>
              </div>
              <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground">
                <ScrambleText text="Start from canonical sources." delayMs={180} />
              </h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {officialReferences.map((item) =>
                item.internal ? (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="inline-flex items-center justify-between rounded-md border border-border bg-card/30 px-4 py-3 text-sm transition-colors hover:bg-card/45"
                  >
                    <span>{item.label}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ) : (
                  <a
                    key={item.label}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-between rounded-md border border-border bg-card/30 px-4 py-3 text-sm transition-colors hover:bg-card/45"
                  >
                    <span>{item.label}</span>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </a>
                ),
              )}
            </div>
          </div>
        </section>

        <section id="tracks" className="py-28 border-t border-border">
          <div className="w-full px-6 lg:px-16 xl:px-24">
            <div className="mb-20 flex max-w-3xl flex-col items-start text-left">
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                  Execution Tracks
                </span>
              </div>
              <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground">
                <ScrambleText text="Prioritize by operational risk and impact." delayMs={180} />
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {tracks.map((track) => (
                <article
                  key={track.title}
                  className="rounded-xl border border-border bg-card/20 p-8 shadow-md dark:shadow-[0_16px_50px_rgba(0,0,0,0.35)]"
                >
                  <h3 className="mb-5 text-lg font-bold tracking-tight text-foreground">{track.title}</h3>
                  <ul className="space-y-3">
                    {track.pages.map((page) => (
                      <li key={page} className="flex items-start gap-3 text-[13px] text-muted-foreground leading-relaxed">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{page}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
