"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function HowItWorks() {
  const [activeTab, setActiveTab] = useState<"cli" | "mcp">("cli");
  const [copied, setCopied] = useState(false);

  const tabs = [
    { id: "cli" as const, number: "01", label: "CLI", sublabel: "Command Line" },
    { id: "mcp" as const, number: "02", label: "MCP", sublabel: "Agent Server" },
  ];

  const installCommands = {
    cli: "pnpm add -g @memories.sh/cli",
    mcp: "memories serve",
  };

  const tabContent = {
    cli: {
      heading: "Three commands. That&apos;s it.",
      description: "Store context, recall it anywhere, and generate configs for any tool—all from your terminal.",
      caption: "Local SQLite database. Works offline. Syncs when you want it to.",
    },
    mcp: {
      heading: "Seven tools. Direct access.",
      description: "Agents interact with your memory store directly via the built-in MCP server.",
      caption: "Works with any MCP-compatible client.",
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

  const cliSteps = [
    {
      cmd: "memories add",
      arg: '"prefer functional components"',
      note: "Store rules and preferences locally",
    },
    {
      cmd: "memories recall",
      arg: '"auth flow"',
      note: "Query context by keyword or meaning",
    },
    {
      cmd: "memories generate",
      arg: "cursor",
      note: "Output native configs for any tool",
    },
  ];

  const mcpSteps = [
    {
      tool: "add_memory",
      params: '{ content: "prefer functional components", type: "rule" }',
      note: "Agents store context directly",
    },
    {
      tool: "get_context",
      params: '{ query: "auth flow" }',
      note: "Returns rules + relevant memories",
    },
    {
      tool: "get_rules",
      params: "{ }",
      note: "All active rules for current project",
    },
  ];

  return (
    <section id="how-it-works" className="relative py-32 lg:py-44">
      <div className="w-full px-6 lg:px-16 xl:px-24">
        {/* Main grid: nav | content | visual */}
        <div className="grid lg:grid-cols-[auto_1fr_1.3fr] gap-8 lg:gap-12 xl:gap-16">
          
          {/* Left vertical navigation */}
          <div className="hidden lg:flex flex-col gap-2 pt-2">
            {/* Progress indicator */}
            <div className="flex items-center gap-1.5 mb-6">
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
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`text-left py-2 transition-all duration-200 group ${
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

          {/* Middle column - Text content + Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-start text-left"
          >
            {/* Section badge */}
            <div className="inline-flex items-center gap-2 mb-6">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
                How It Works
              </span>
            </div>

            {/* Main heading */}
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight text-foreground mb-4">
              {tabContent[activeTab].heading.replace("&apos;", "'")}
            </h2>
            
            {/* Description */}
            <p className="text-lg text-muted-foreground mb-10 max-w-md">
              {tabContent[activeTab].description}
            </p>

            {/* Mobile tab switcher */}
            <div className="lg:hidden mb-6">
              <div className="inline-flex items-center p-1 bg-muted border border-border rounded-lg">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
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

            {/* Install card */}
            <div className="w-full max-w-md p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm">
              {/* Card header */}
              <div className="flex items-center gap-2 mb-5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {activeTab === "cli" ? "01 - Command Line" : "02 - Agent Server"}
                </span>
              </div>

              {/* Install command */}
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/50 border border-border rounded-lg font-mono text-sm mb-5">
                <span className="text-muted-foreground select-none">$</span>
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

              {/* Card title */}
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {activeTab === "cli" ? "Store, recall, generate" : "Direct agent access"}
              </h3>

              {/* Card description */}
              <p className="text-sm text-muted-foreground mb-4">
                {tabContent[activeTab].caption}
              </p>

              {/* Link */}
              <a
                href={activeTab === "cli" ? "/docs/cli" : "/docs/mcp-server"}
                className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
              >
                Learn more
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>
          </motion.div>

          {/* Right column - Terminal visual */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            {/* Tab label on top right of terminal */}
            <div className="absolute -top-6 right-0 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {activeTab === "cli" ? "Terminal" : "MCP Server"}
            </div>

            {/* Terminal frame */}
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-lg dark:shadow-2xl dark:shadow-black/50">
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/50">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                  <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                </div>
                <span className="ml-3 text-xs text-muted-foreground font-mono">
                  {activeTab === "cli" ? "~/project" : "mcp-server"}
                </span>
              </div>

              {/* Content */}
              <div className="p-6 md:p-8 space-y-6 font-mono min-h-[320px]">
                {activeTab === "cli" ? (
                  <>
                    {cliSteps.map((step, i) => (
                      <motion.div
                        key={`cli-${i}`}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ 
                          duration: 0.5, 
                          delay: 0.1 + i * 0.1,
                          ease: [0.16, 1, 0.3, 1]
                        }}
                        className="group"
                      >
                        <div className="flex items-baseline gap-3 text-sm md:text-base">
                          <span className="text-primary/60 select-none">$</span>
                          <span className="text-foreground font-medium">{step.cmd}</span>
                          <span className="text-primary">{step.arg}</span>
                        </div>
                        <div className="mt-1.5 ml-5 text-xs text-muted-foreground">
                          <span className="text-muted-foreground/50">→</span> {step.note}
                        </div>
                      </motion.div>
                    ))}
                    <div className="flex items-center gap-3 text-sm md:text-base">
                      <span className="text-primary/60 select-none">$</span>
                      <span className="w-2 h-4 bg-primary/70 animate-pulse" />
                    </div>
                  </>
                ) : (
                  <>
                    {mcpSteps.map((step, i) => (
                      <motion.div
                        key={`mcp-${i}`}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ 
                          duration: 0.5, 
                          delay: 0.1 + i * 0.1,
                          ease: [0.16, 1, 0.3, 1]
                        }}
                        className="group"
                      >
                        <div className="flex items-baseline gap-2 text-sm md:text-base flex-wrap">
                          <span className="text-primary font-medium">{step.tool}</span>
                          <span className="text-muted-foreground text-xs">{step.params}</span>
                        </div>
                        <div className="mt-1.5 text-xs text-muted-foreground">
                          <span className="text-muted-foreground/50">→</span> {step.note}
                        </div>
                      </motion.div>
                    ))}
                    <div className="text-xs text-muted-foreground/60 pt-4 border-t border-border">
                      + 4 more tools: search_memories, list_memories, edit_memory, forget_memory
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Ambient glow */}
            <div className="absolute -inset-px rounded-xl bg-gradient-to-b from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
