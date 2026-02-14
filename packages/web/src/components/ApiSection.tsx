"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ScrambleText } from "./animations/ScrambleText";
import { getSyntaxTokenClass, tokenizeJson } from "./ui/syntax";

interface ApiShowcaseItem {
  id: string;
  label: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
  request: string;
  response: string;
}

const apiShowcase: ApiShowcaseItem[] = [
  {
    id: "context",
    label: "Context Retrieval",
    method: "POST",
    path: "/api/sdk/v1/context/get",
    summary:
      "Pull rules + memories with scoped routing and graph-aware retrieval strategy controls.",
    request: `{
  "query": "how do we ship rollout safely?",
  "strategy": "hybrid_graph",
  "graphDepth": 1,
  "scope": {
    "tenantId": "webrenew-prod",
    "userId": "charles@webrenew.io",
    "projectId": "github.com/webrenew/memories"
  }
}`,
    response: `{
  "ok": true,
  "data": {
    "rules": [...],
    "memories": [...],
    "trace": {
      "strategy": "hybrid_graph",
      "rolloutMode": "canary"
    }
  },
  "error": null,
  "meta": { "endpoint": "/api/sdk/v1/context/get" }
}`,
  },
  {
    id: "write",
    label: "Memory Writes",
    method: "POST",
    path: "/api/sdk/v1/memories/add",
    summary:
      "Store typed memories with metadata, tags, and explicit tenant/user/repo scope controls.",
    request: `{
  "content": "Use .env as local source of truth",
  "type": "rule",
  "category": "setup",
  "tags": ["env", "config"],
  "scope": {
    "tenantId": "webrenew-prod",
    "userId": "charles@webrenew.io",
    "projectId": "github.com/webrenew/memories",
  }
}`,
    response: `{
  "ok": true,
  "data": {
    "id": "mem_abc123",
    "message": "Stored rule (project:memories): ...",
    "memory": { "type": "rule", "layer": "rule" }
  },
  "error": null,
  "meta": { "endpoint": "/api/sdk/v1/memories/add" }
}`,
  },
  {
    id: "graph",
    label: "Graph Rollout",
    method: "PATCH",
    path: "/api/sdk/v1/graph/rollout",
    summary:
      "Control `off | shadow | canary` rollout with quality gate enforcement before canary promotion.",
    request: `{
  "mode": "canary",
  "scope": {
    "tenantId": "webrenew-prod",
    "projectId": "github.com/webrenew/memories"
  }
}`,
    response: `{
  "ok": false,
  "data": null,
  "error": {
    "code": "CANARY_ROLLOUT_BLOCKED",
    "status": 409,
    "details": {
      "reasonCodes": ["FALLBACK_RATE_ABOVE_LIMIT"]
    }
  },
  "meta": { "endpoint": "/api/sdk/v1/graph/rollout" }
}`,
  },
];

const contractPoints: { title: string; detail: React.ReactNode }[] = [
  {
    title: "Single Envelope",
    detail: <><code className="font-mono text-[0.9em] text-foreground/80 bg-muted px-1 py-0.5 rounded">ok / data / error / meta</code> on every SDK endpoint.</>,
  },
  {
    title: "Request Tracing",
    detail: <>Every response includes <code className="font-mono text-[0.9em] text-foreground/80 bg-muted px-1 py-0.5 rounded">meta.requestId</code> for support and logs.</>,
  },
  {
    title: "Typed Errors",
    detail: <>Stable <code className="font-mono text-[0.9em] text-foreground/80 bg-muted px-1 py-0.5 rounded">error.type</code> and <code className="font-mono text-[0.9em] text-foreground/80 bg-muted px-1 py-0.5 rounded">error.code</code> for deterministic client handling.</>,
  },
  {
    title: "Versioned Surface",
    detail: <>Breaking changes move to <code className="font-mono text-[0.9em] text-foreground/80 bg-muted px-1 py-0.5 rounded">/api/sdk/v2/*</code>, not v1 drift.</>,
  },
];

function methodClass(method: ApiShowcaseItem["method"]): string {
  if (method === "GET") return "text-emerald-300 border-emerald-400/30 bg-emerald-500/10";
  if (method === "PATCH") return "text-amber-200 border-amber-300/30 bg-amber-500/10";
  return "text-sky-200 border-sky-300/30 bg-sky-500/10";
}

export function ApiSection(): React.JSX.Element | null {
  const [selected, setSelected] = useState(apiShowcase[0]?.id ?? "context");

  const active = useMemo(
    () => apiShowcase.find((item) => item.id === selected) ?? apiShowcase[0],
    [selected],
  );
  const requestLines = useMemo(() => tokenizeJson(active?.request ?? ""), [active?.request]);
  const responseLines = useMemo(() => tokenizeJson(active?.response ?? ""), [active?.response]);

  if (!active) return null;

  return (
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
              API Contract
            </span>
          </div>
          <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground">
            <ScrambleText text="Production API that actually ships fast." delayMs={200} />
          </h2>
          <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-3xl leading-relaxed">
            One predictable SDK surface for retrieval, writes, graph rollout, and diagnostics. Designed for strict
            clients and fast incident debugging. `tenantId` is the database boundary, `userId` is end-user scope, and
            `projectId` is an optional repo context filter. Default SDK transport is HTTP API; MCP transport is optional.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] items-start">
          <div className="grid gap-2">
            {apiShowcase.map((item) => {
              const isActive = item.id === active.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSelected(item.id)}
                  className={`text-left px-4 py-4 border rounded-lg transition-all ${
                    isActive
                      ? "border-primary/50 bg-primary/10 shadow-[0_0_30px_rgba(99,102,241,0.15)]"
                      : "border-border bg-card/20 hover:bg-card/40 hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold tracking-tight text-foreground">{item.label}</span>
                    <span className={`px-2 py-0.5 border rounded font-mono text-[10px] ${methodClass(item.method)}`}>
                      {item.method}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground break-all">{item.path}</p>
                </button>
              );
            })}
          </div>

          <div className="border border-border rounded-xl bg-card/20 overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-foreground/[0.03]">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`px-2 py-1 border rounded font-mono text-[10px] ${methodClass(active.method)}`}>
                  {active.method}
                </span>
                <code className="font-mono text-xs text-foreground/90 break-all">{active.path}</code>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{active.summary}</p>
            </div>

            <div className="grid xl:grid-cols-2 gap-0">
              <div className="p-5 border-b xl:border-b-0 xl:border-r border-border">
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground mb-3">Request</p>
                <pre className="overflow-hidden rounded-lg border border-border bg-background px-4 py-3 text-[11px] leading-relaxed">
                  <code className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {requestLines.map((line, lineIndex) => (
                      <span key={`request-line-${lineIndex}`} className="block">
                        {line.tokens.length === 0 ? (
                          <span>&nbsp;</span>
                        ) : (
                          line.tokens.map((token, tokenIndex) => (
                            <span
                              key={`request-line-${lineIndex}-token-${tokenIndex}`}
                              className={getSyntaxTokenClass(token.style)}
                            >
                              {token.text}
                            </span>
                          ))
                        )}
                      </span>
                    ))}
                  </code>
                </pre>
              </div>
              <div className="p-5">
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground mb-3">
                  Response
                </p>
                <pre className="overflow-hidden rounded-lg border border-border bg-background px-4 py-3 text-[11px] leading-relaxed">
                  <code className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {responseLines.map((line, lineIndex) => (
                      <span key={`response-line-${lineIndex}`} className="block">
                        {line.tokens.length === 0 ? (
                          <span>&nbsp;</span>
                        ) : (
                          line.tokens.map((token, tokenIndex) => (
                            <span
                              key={`response-line-${lineIndex}-token-${tokenIndex}`}
                              className={getSyntaxTokenClass(token.style)}
                            >
                              {token.text}
                            </span>
                          ))
                        )}
                      </span>
                    ))}
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {contractPoints.map((point) => (
            <div key={point.title} className="relative border border-border bg-card/20 rounded-lg p-4 overflow-hidden">
              <div
                className="absolute inset-0 opacity-[0.07] bg-cover bg-center bg-no-repeat pointer-events-none"
                style={{ backgroundImage: "url(/bg-texture_memories.webp)" }}
              />
              <p className="relative text-[10px] uppercase tracking-[0.17em] font-bold text-foreground mb-2">{point.title}</p>
              <p className="relative text-xs text-muted-foreground leading-relaxed">{point.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-3">
          <Link
            href="/docs/sdk/endpoint-contract"
            className="inline-flex items-center gap-2 px-4 py-2 border border-primary/40 bg-primary/10 text-primary text-xs uppercase tracking-[0.16em] font-bold hover:bg-primary/20 transition-colors rounded-md"
          >
            Full Endpoint Contract
            <span aria-hidden>→</span>
          </Link>
          <Link
            href="/docs/sdk"
            className="inline-flex items-center gap-2 px-4 py-2 border border-border bg-card/30 text-muted-foreground text-xs uppercase tracking-[0.16em] font-bold hover:text-foreground hover:border-primary/30 transition-colors rounded-md"
          >
            SDK Quickstart
          </Link>
        </div>
      </div>
    </section>
  );
}
