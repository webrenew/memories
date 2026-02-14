import React from "react"
import type { ReactNode } from "react";
import Link from "next/link";
import { ScrambleText } from "./animations/ScrambleText";

const layers: {
  label: string;
  pkg: string;
  description: ReactNode;
  accent: boolean;
  href: string;
}[] = [
  {
    label: "SDK",
    pkg: "@memories.sh/ai-sdk",
    description: (
      <>
        <code className="font-mono text-[0.9em] text-foreground/80 bg-muted px-1.5 py-0.5 rounded">memoriesMiddleware()</code>{" "}
        connects any model to cloud memory. Pair with AI SDK Projects in the dashboard.
      </>
    ),
    accent: true,
    href: "/docs/sdk",
  },
  {
    label: "MCP",
    pkg: "memories serve",
    description:
      "7 tools, FTS5 search, real-time access for browser-based agents and MCP clients.",
    accent: false,
    href: "/docs/mcp-server",
  },
  {
    label: "CLI",
    pkg: "npx memories",
    description:
      "Local SQLite, embeddings, 13+ tool configs, offline-first. The foundation.",
    accent: false,
    href: "/docs/cli",
  },
];

export function SDKSection(): React.JSX.Element {
  return (
    <section className="py-28 border-t border-border">
      <div className="w-full px-6 lg:px-16 xl:px-24">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-start">
          {/* Left column — header + description */}
          <div className="lg:sticky lg:top-32">
            <div className="inline-flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                TypeScript SDK
              </span>
            </div>

            <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground mb-6">
              <ScrambleText text="Cloud-native memory for AI apps and dev teams." delayMs={200} />
            </h2>

            <p className="text-base sm:text-lg text-muted-foreground max-w-lg mb-4 leading-relaxed">
              The SDK connects your AI apps to memories.sh cloud—giving every
              prompt the right rules and context. <code className="font-mono text-[0.9em] text-foreground/80 bg-muted px-1.5 py-0.5 rounded">memoriesMiddleware()</code> is
              all it takes.
            </p>
            <p className="text-base sm:text-lg text-muted-foreground max-w-lg mb-8 leading-relaxed">
              Start in Dashboard → AI SDK Projects to create your API key and
              project isolation (`tenantId`). Then add middleware and ship. The
              CLI and MCP handle local-first storage and agent access, while the
              SDK handles your app runtime.
            </p>

            <Link
              href="/docs/sdk"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Read the SDK docs
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>

          {/* Right column — stacked architecture layers */}
          <div className="flex flex-col items-stretch">
            {layers.map((layer, idx) => (
              <div key={layer.label} className="flex flex-col items-stretch">
                {/* Connecting line between layers */}
                {idx > 0 && (
                  <div className="flex justify-center">
                    <div className="w-px h-6 bg-border" />
                  </div>
                )}

                <Link
                  href={layer.href}
                  className={`group relative p-6 lg:p-8 border rounded-lg transition-all ${
                    layer.accent
                      ? "bg-primary/10 border-primary/30 hover:border-primary/50 hover:bg-primary/15"
                      : "bg-card/30 border-border hover:ring-1 hover:ring-primary/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`font-mono text-xs font-bold uppercase tracking-widest ${
                          layer.accent
                            ? "text-primary"
                            : "text-muted-foreground"
                        }`}
                      >
                        {layer.label}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground/70">
                        {layer.pkg}
                      </span>
                    </div>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0 mt-0.5"
                    >
                      <path d="M7 17L17 7M7 7h10v10" />
                    </svg>
                  </div>

                  <p className="text-[13px] text-muted-foreground leading-relaxed font-light">
                    {layer.description}
                  </p>
                </Link>
              </div>
            ))}

            {/* "Built on" annotation */}
            <div className="flex justify-center mt-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/50">
                ↑ built on ↑
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
