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
      heading: "Three commands. That's it.",
      description: "Store context, recall it anywhere, and generate configs for any tool—all from your terminal.",
      cardTitle: "Store, recall, generate",
      cardDescription: "Local SQLite database. Works offline. Syncs when you want it to.",
    },
    mcp: {
      heading: "Seven tools. Direct access.",
      description: "Agents interact with your memory store directly via the built-in MCP server.",
      cardTitle: "Direct agent access",
      cardDescription: "Works with any MCP-compatible client.",
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
                {tabContent[activeTab].heading}
              </h2>
              
              {/* Description */}
              <p className="text-lg text-muted-foreground max-w-md">
                {tabContent[activeTab].description}
              </p>
            </motion.div>

            {/* Spacer to push card down */}
            <div className="flex-1 min-h-8" />

            {/* Install card - Full width, bottom of content area */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="w-full p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm mb-16 lg:mb-24"
            >
              {/* Card header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    {activeTab === "cli" ? "01 - Command Line" : "02 - Agent Server"}
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
                href={activeTab === "cli" ? "/docs/cli" : "/docs/mcp-server"}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-wider border border-border rounded hover:bg-muted transition-colors text-foreground"
              >
                Quickstart Guide
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>

              {/* Card title and description */}
              <div className="mt-6 pt-5 border-t border-border">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {tabContent[activeTab].cardTitle}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {tabContent[activeTab].cardDescription}
                </p>
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
                    onClick={() => setActiveTab(tab.id)}
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
          </div>

          {/* Right column - Terminal vertically centered */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex items-center"
          >
            <div className="w-full">
              {/* Tab label on top right of terminal */}
              <div className="flex justify-end mb-4">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {activeTab === "cli" ? "Terminal" : "MCP Server"}
                </span>
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
                <div className="p-6 md:p-8 space-y-6 font-mono">
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

              {/* Bottom labels */}
              <div className="flex justify-between mt-4">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {activeTab === "cli" ? "CLI" : "MCP"}
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
