"use client";

import { motion, useInView } from "framer-motion";
import React, { useState, useEffect, useRef } from "react";
import { Check, Copy } from "lucide-react";
import { ScrambleText } from "./animations/ScrambleText";
import { getSyntaxTokenClass, type SyntaxLine } from "./ui/syntax";

// ── Module-level constants (stable references for effects) ──────────────────

const cliSteps = [
  {
    cmd: "memories add",
    arg: '"prefer functional components"',
    note: "Stored to local SQLite database",
  },
  {
    cmd: "memories recall",
    arg: '"auth flow"',
    note: "3 memories matched by semantic similarity",
  },
  {
    cmd: "memories generate",
    arg: "cursor",
    note: "Wrote .cursor/rules/memories.mdc",
  },
];

const mcpSteps = [
  {
    tool: "add_memory",
    params: '{ content: "use zod for validation", type: "rule", paths: ["src/api/**"] }',
    note: "Path-scoped rules with glob patterns",
  },
  {
    tool: "get_context",
    params: '{ query: "auth flow" }',
    note: "FTS5-ranked rules + relevant memories",
  },
  {
    tool: "get_rules",
    params: "{ }",
    note: "All active rules for current project",
  },
];

const sdkCodeLines: SyntaxLine[] = [
  { tokens: [{ text: "import", style: "keyword" }, { text: " { wrapLanguageModel } ", style: "default" }, { text: "from", style: "keyword" }, { text: ' "ai"', style: "string" }] },
  { tokens: [{ text: "import", style: "keyword" }, { text: " { memoriesMiddleware } ", style: "default" }, { text: "from", style: "keyword" }, { text: ' "@memories.sh/ai-sdk"', style: "string" }] },
  { tokens: [] },
  { tokens: [{ text: "const", style: "keyword" }, { text: " model = ", style: "default" }, { text: "wrapLanguageModel", style: "fn" }, { text: "({", style: "default" }] },
  { tokens: [{ text: "  model: ", style: "default" }, { text: "anthropic", style: "fn" }, { text: "(", style: "default" }, { text: '"claude-opus-4.6"', style: "string" }, { text: "),", style: "default" }] },
  { tokens: [{ text: "  middleware: ", style: "default" }, { text: "memoriesMiddleware", style: "fn" }, { text: "()", style: "default" }] },
  { tokens: [{ text: "})", style: "default" }] },
  { tokens: [] },
  { tokens: [{ text: "// Rules + memories auto-injected into every prompt", style: "comment" }] },
];

// ── Component ───────────────────────────────────────────────────────────────

export function HowItWorks(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"cli" | "mcp" | "sdk">("cli");
  const [copied, setCopied] = useState(false);
  const [endpointCopied, setEndpointCopied] = useState(false);

  const tabs = [
    { id: "cli" as const, number: "01", label: "CLI", sublabel: "Command Line" },
    { id: "mcp" as const, number: "02", label: "MCP", sublabel: "Fallback" },
    { id: "sdk" as const, number: "03", label: "SDK", sublabel: "TypeScript" },
  ];
  const installCommands: Record<string, string> = { cli: "pnpm add -g @memories.sh/cli", mcp: "memories serve", sdk: "pnpm add @memories.sh/ai-sdk" };

  const tabContent = {
    cli: {
      heading: "Three commands. That's it.",
      description: "Store context, recall it anywhere, and generate configs for any tool—all from your terminal.",
      cardTitle: "Store, recall, generate",
      cardDescription: "Local SQLite database. Works offline. Syncs when you want it to.",
    },
    mcp: {
      heading: "MCP when you need it.",
      description: "For browser-based agents like v0, bolt.new, and Lovable—or any MCP client that can't run the CLI—7 tools with FTS5 search give full access to your memory store.",
      cardTitle: "Direct agent fallback",
      cardDescription: "Same 7 tools as CLI. FTS5 search, path-scoped rules, skills, and full field support.",
      endpoint: "https://memories.sh/api/mcp",
    },
    sdk: {
      heading: "Two lines. Memory everywhere.",
      description: <>Wrap any model with <code className="font-mono text-[0.9em] text-foreground/80 bg-muted px-1.5 py-0.5 rounded">memoriesMiddleware()</code>. Rules and context auto-inject into every prompt—no tool calls, no prompt engineering.</>,
      cardTitle: "AI SDK middleware",
      cardDescription: <><code className="font-mono text-[0.9em] text-foreground/80 bg-muted px-1.5 py-0.5 rounded">@memories.sh/ai-sdk</code> — composable middleware for the Vercel AI SDK. Stack with logging, guardrails, caching.</>,
    },
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(installCommands[activeTab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleEndpointCopy = async () => {
    try {
      await navigator.clipboard.writeText(tabContent.mcp.endpoint);
      setEndpointCopied(true);
      setTimeout(() => setEndpointCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy endpoint:", error);
    }
  };

  // ── Typing animation ────────────────────────────────────────────────────
  const terminalRef = useRef<HTMLDivElement>(null);
  const isTerminalInView = useInView(terminalRef, { once: true, amount: 0.3 });
  const isAutoPlaying = useRef(true);

  const [typing, setTyping] = useState({
    completedSteps: 0,
    charIndex: 0,
    noteVisible: false,
  });

  // Reset when tab changes
  useEffect(() => {
    setTyping({ completedSteps: 0, charIndex: 0, noteVisible: false });
  }, [activeTab]);

  // Drive the typing animation frame-by-frame (works for CLI and MCP tabs; SDK is static)
  useEffect(() => {
    if (!isTerminalInView || activeTab === "sdk") return;

    const steps = activeTab === "cli" ? cliSteps : mcpSteps;
    const { completedSteps, charIndex, noteVisible } = typing;
    if (completedSteps >= steps.length) return;

    // CLI types full "cmd arg"; MCP types only the tool name, then flashes params
    let typeableLength: number;
    if (activeTab === "cli") {
      const step = cliSteps[completedSteps];
      typeableLength = `${step.cmd} ${step.arg}`.length;
    } else {
      typeableLength = mcpSteps[completedSteps].tool.length;
    }

    if (charIndex < typeableLength) {
      const delay = completedSteps === 0 && charIndex === 0 ? 600 : 40;
      const timer = setTimeout(() => {
        setTyping((prev) => ({ ...prev, charIndex: prev.charIndex + 1 }));
      }, delay);
      return () => clearTimeout(timer);
    }

    if (!noteVisible) {
      const timer = setTimeout(() => {
        setTyping((prev) => ({ ...prev, noteVisible: true }));
      }, 300);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setTyping({
        completedSteps: completedSteps + 1,
        charIndex: 0,
        noteVisible: false,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [isTerminalInView, activeTab, typing]);

  // Auto-advance: CLI → MCP → SDK
  useEffect(() => {
    if (!isAutoPlaying.current) return;
    if (activeTab === "cli" && typing.completedSteps >= cliSteps.length) {
      const timer = setTimeout(() => setActiveTab("mcp"), 1000);
      return () => clearTimeout(timer);
    }
    if (activeTab === "mcp" && typing.completedSteps >= mcpSteps.length) {
      const timer = setTimeout(() => setActiveTab("sdk"), 1000);
      return () => clearTimeout(timer);
    }
  }, [activeTab, typing.completedSteps]);

  const handleTabClick = (tabId: "cli" | "mcp" | "sdk") => {
    isAutoPlaying.current = false;
    setActiveTab(tabId);
  };

  return (
    <section id="how-it-works" className="relative py-32 lg:py-44 border-y border-border bg-background-secondary">
      <div className="w-full px-6 lg:px-16 xl:px-24">
        {/* Two column grid */}
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 xl:gap-24 min-h-[600px]">
          
          {/* Left column - Header top, Card bottom, Tabs absolute bottom */}
          <div className="flex flex-col relative">
            {/* Top section - Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.05 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col items-start text-left transform-gpu"
            >
              {/* Section badge */}
              <div className="inline-flex items-center gap-2 mb-6">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                  How It Works
                </span>
              </div>

              {/* Main heading */}
              <h2 className="font-mono font-normal text-2xl sm:text-4xl tracking-tight text-foreground mb-4">
                <ScrambleText key={activeTab} text={tabContent[activeTab].heading} delayMs={0} duration={0.6} />
              </h2>
              
              {/* Description */}
              <p className="text-base sm:text-lg text-muted-foreground max-w-md leading-relaxed">
                {tabContent[activeTab].description}
              </p>
            </motion.div>

            {/* Spacer to push card down */}
            <div className="flex-1 min-h-8" />

            {/* Install card - Full width, bottom of content area */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.05 }}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="w-full p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm mb-16 lg:mb-24 transform-gpu"
            >
              {/* Card header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    {activeTab === "cli" ? "01 - Command Line" : activeTab === "mcp" ? "02 - Agent Server" : "03 - TypeScript SDK"}
                  </span>
                </div>
              </div>

              {/* Install command */}
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/50 border border-border rounded-lg font-mono text-sm mb-5">
                <span className="text-muted-foreground select-none">&gt;</span>
                <code className="text-foreground flex-1">{installCommands[activeTab]}</code>
                <button
                  onClick={handleCopy}
                  className="p-1.5 hover:bg-foreground/10 rounded-md transition-colors text-muted-foreground hover:text-foreground"
                  aria-label="Copy command"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Quickstart link */}
              <a
                href={activeTab === "cli" ? "/docs/cli" : activeTab === "mcp" ? "/docs/mcp-server" : "/docs/sdk"}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-wider border border-border rounded hover:bg-muted transition-colors text-foreground"
              >
                Quickstart Guide
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>

              {/* Card title and description */}
              <div className="mt-6 pt-5 border-t border-border">
                <h3 className="font-mono font-normal text-xl sm:text-2xl text-foreground mb-2">
                  {tabContent[activeTab].cardTitle}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {tabContent[activeTab].cardDescription}
                </p>
                
                {/* MCP Endpoint URL */}
                {activeTab === "mcp" && (
                  <div className="mb-4 p-3 bg-muted/50 border border-border rounded-lg">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Endpoint</span>
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-sm font-mono">
                        <span className="text-muted-foreground">https://</span>
                        <span className="text-foreground">memories.sh/api/mcp</span>
                      </code>
                      <button
                        onClick={handleEndpointCopy}
                        className="p-1.5 hover:bg-foreground/10 rounded-md transition-colors text-muted-foreground hover:text-foreground flex-shrink-0"
                        aria-label="Copy endpoint"
                      >
                        {endpointCopied ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
                
                <a
                  href={activeTab === "cli" ? "/docs/cli" : activeTab === "mcp" ? "/docs/mcp-server" : "/docs/sdk"}
                  className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                >
                  Learn more
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              </div>
            </motion.div>

            {/* Tab navigation - Absolute bottom left */}
            <div className="hidden lg:block">
              {/* Progress indicator */}
              <div className="flex items-center gap-1.5 mb-4">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`h-1 rounded-full transition-all duration-300 ${
                      activeTab === tab.id 
                        ? "w-6 bg-primary" 
                        : "w-2 bg-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
              
              {/* Tab buttons */}
              <div className="flex flex-col gap-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleTabClick(tab.id)}
                    className={`text-left py-1.5 transition-all duration-200 group ${
                      activeTab === tab.id 
                        ? "text-foreground" 
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`font-mono text-xs transition-colors ${
                        activeTab === tab.id ? "text-primary" : "text-muted-foreground/50"
                      }`}>
                        {tab.number}
                      </span>
                      <span className="font-mono text-sm uppercase tracking-wider">
                        {tab.sublabel}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile tab switcher */}
            <div className="lg:hidden mb-6">
              <div className="inline-flex items-center p-1 bg-muted border border-border rounded-lg">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleTabClick(tab.id)}
                    className={`px-4 py-2 text-sm font-mono uppercase tracking-wider rounded-md transition-all duration-200 ${
                      activeTab === tab.id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right column - Terminal vertically centered */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.05 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex items-center transform-gpu"
          >
            <div className="w-full">
              {/* Tab label on top right of terminal */}
              <div className="flex justify-end mb-4">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {activeTab === "cli" ? "Terminal" : activeTab === "mcp" ? "MCP Server" : "app.ts"}
                </span>
              </div>

              {/* Terminal frame */}
              <div
                ref={terminalRef}
                className="rounded-xl border border-border bg-card overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50"
              >
                {/* Title bar */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/50">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                    <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                    <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                  </div>
                  <span className="ml-3 text-xs text-muted-foreground font-mono">
                    {activeTab === "cli" ? "~/project" : activeTab === "mcp" ? "mcp-server" : "app.ts"}
                  </span>
                </div>

                {/* Content */}
                <div className="p-6 md:p-8 space-y-6 font-mono">
                  {activeTab === "sdk" ? (
                    <div className="space-y-0.5">
                      {sdkCodeLines.map((line, i) => (
                        <motion.div
                          key={`sdk-${i}`}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3, delay: i * 0.06 }}
                          className="text-sm md:text-base leading-relaxed"
                        >
                          {line.tokens.length === 0 ? (
                            <span>&nbsp;</span>
                          ) : (
                            line.tokens.map((token, j) => (
                              <span
                                key={j}
                                className={getSyntaxTokenClass(token.style)}
                              >
                                {token.text}
                              </span>
                            ))
                          )}
                        </motion.div>
                      ))}
                    </div>
                  ) : activeTab === "cli" ? (
                    <>
                      {cliSteps.map((step, i) => {
                        const fullCmd = `${step.cmd} ${step.arg}`;
                        const isComplete = i < typing.completedSteps;
                        const isCurrent =
                          i === typing.completedSteps &&
                          typing.completedSteps < cliSteps.length;

                        if (!isComplete && !isCurrent) return (
                          <div key={`cli-${i}`} className="invisible" aria-hidden>
                            <div className="flex items-baseline gap-3 text-sm md:text-base">
                              <span>$</span><span>{fullCmd}</span>
                            </div>
                            <div className="mt-1.5 ml-5 text-xs">{step.note}</div>
                          </div>
                        );

                        const displayChars = isComplete ? fullCmd.length : typing.charIndex;
                        const cmdEnd = step.cmd.length;
                        const typedCmd = fullCmd.slice(0, Math.min(displayChars, cmdEnd));
                        const hasSpace = displayChars > cmdEnd;
                        const typedArg = displayChars > cmdEnd + 1 ? step.arg.slice(0, displayChars - cmdEnd - 1) : "";
                        const showNote = isComplete || (isCurrent && typing.noteVisible);
                        const showCursor = isCurrent && !typing.noteVisible;

                        return (
                          <div key={`cli-${i}`}>
                            <div className="flex items-baseline gap-3 text-sm md:text-base">
                              <span className="text-primary/60 select-none">
                                $
                              </span>
                              <span>
                                <span className="text-foreground font-medium">
                                  {typedCmd}
                                </span>
                                {hasSpace && " "}
                                {typedArg && (
                                  <span className="text-primary">
                                    {typedArg}
                                  </span>
                                )}
                                {showCursor && (
                                  <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-px" />
                                )}
                              </span>
                            </div>
                            <div
                              className={`mt-1.5 ml-5 text-xs text-muted-foreground transition-opacity duration-300 ${
                                showNote ? "opacity-100" : "opacity-0"
                              }`}
                            >
                              {step.note}
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex items-center gap-3 text-sm md:text-base">
                        <span className="text-primary/60 select-none">$</span>
                        {typing.completedSteps >= cliSteps.length && (
                          <span className="w-2 h-4 bg-primary/70 animate-pulse" />
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      {mcpSteps.map((step, i) => {
                        const isComplete = i < typing.completedSteps;
                        const isCurrent =
                          i === typing.completedSteps &&
                          typing.completedSteps < mcpSteps.length;

                        if (!isComplete && !isCurrent) return (
                          <div key={`mcp-${i}`} className="invisible" aria-hidden>
                            <div className="flex items-baseline gap-2 text-sm md:text-base flex-wrap">
                              <span>{step.tool}</span><span className="text-xs">{step.params}</span>
                            </div>
                            <div className="mt-1.5 text-xs">{step.note}</div>
                          </div>
                        );

                        const displayChars = isComplete ? step.tool.length : typing.charIndex;
                        const typedTool = step.tool.slice(0, displayChars);
                        const showParams = isComplete || displayChars >= step.tool.length;
                        const showNote = isComplete || (isCurrent && typing.noteVisible);
                        const showCursor = isCurrent && displayChars < step.tool.length;

                        return (
                          <div key={`mcp-${i}`}>
                            <div className="flex items-baseline gap-2 text-sm md:text-base flex-wrap">
                              <span className="text-primary font-medium">
                                {typedTool}
                              </span>
                              {showParams && (
                                <motion.span
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ duration: 0.15 }}
                                  className="text-muted-foreground text-xs"
                                >
                                  {step.params}
                                </motion.span>
                              )}
                              {showCursor && (
                                <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-px" />
                              )}
                            </div>
                            <div
                              className={`mt-1.5 text-xs text-muted-foreground transition-opacity duration-300 ${
                                showNote ? "opacity-100" : "opacity-0"
                              }`}
                            >
                              {step.note}
                            </div>
                          </div>
                        );
                      })}
                      <div className={`text-xs text-muted-foreground/60 pt-4 border-t border-border transition-opacity duration-300 ${
                        typing.completedSteps >= mcpSteps.length ? "opacity-100" : "opacity-0"
                      }`}>
                        + 6 more tools: search_memories, list_memories, edit_memory, forget_memory, bulk_forget_memories, vacuum_memories
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Bottom labels */}
              <div className="flex justify-between mt-4">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {activeTab === "cli" ? "CLI" : activeTab === "mcp" ? "MCP" : "SDK"}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {tabContent[activeTab].cardTitle}
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
