"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrambleText } from "./animations/ScrambleText";

export function FAQ(): React.JSX.Element {
  const c = "font-mono text-[0.9em] text-foreground/80 bg-muted px-1.5 py-0.5 rounded";
  const faqs: { q: string; a: React.ReactNode }[] = [
    {
      q: "What problem does memories.sh solve?",
      a: "Agents forget and switching tools resets context. memories.sh gives you a durable, local-first state layer so rules, decisions, facts, and skills persist—with path-scoped rules, FTS5 search, and native config generation for 13+ tools."
    },
    {
      q: "Can I switch between coding agents easily?",
      a: "Yes. Store state once and generate native configs for each tool. Your context stays consistent, so you do not re-teach every time you switch."
    },
    {
      q: "What's the difference between global and project memory?",
      a: <>Global memory is your persistent state across tools and projects. Project memory is repo-specific and auto-scoped via git remote. You can also create path-scoped rules with glob patterns (e.g. <code className={c}>src/api/**</code>) for fine-grained context. In SDK apps, scope terms are different: <code className={c}>tenantId</code> is the security/database boundary, <code className={c}>userId</code> is end-user scope, and <code className={c}>projectId</code> is an optional repo context filter.</>
    },
    {
      q: "Am I locked into memories.sh?",
      a: <>No. Export state to JSON or YAML anytime with <code className={c}>memories export</code>. Generate native config files for supported tools. Your data stays portable.</>
    },
    {
      q: "Where is my data stored?",
      a: <>All data is stored locally at <code className={c}>~/.config/memories/</code> on your machine. Cloud sync (Pro) is optional for backup and multi-machine continuity.</>
    },
    {
      q: "Which coding agents are supported?",
      a: "Cursor, Claude Code, GitHub Copilot, Windsurf, Cline, Roo, Gemini, Amp, Codex, OpenCode, Kilo, Trae, Goose, plus any MCP-compatible client via the built-in server."
    },
    {
      q: "What is the SDK for?",
      a: <>The TypeScript SDK (<code className={c}>@memories.sh/ai-sdk</code>) lets you wire persistent memory into AI apps. <code className={c}>memoriesMiddleware()</code> wraps any Vercel AI SDK model so rules and context auto-inject into every prompt. For agent loops, use <code className={c}>memoriesTools()</code> to let the LLM manage memory directly. Use <code className={c}>tenantId</code> as the security/database boundary, <code className={c}>userId</code> for end-user scope, and <code className={c}>projectId</code> as an optional repo context filter.</>
    }
  ];

    return (
      <section id="faq" className="py-28 px-6 lg:px-16 xl:px-24 border-t border-white/10">
        <div className="max-w-[1000px] mx-auto">
          <div className="mb-20 flex max-w-3xl flex-col items-start text-left">
            <div className="inline-flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">Support</span>
            </div>
            <h2 className="font-mono font-normal text-2xl sm:text-4xl text-foreground">
              <ScrambleText text="Questions & Answers" delayMs={200} />
            </h2>
            <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl leading-relaxed">
              Common questions about memories.sh and how it works.
            </p>
          </div>
          <div className="space-y-1">
            {faqs.map((faq, idx) => (
              <FAQItem key={idx} question={faq.q} answer={faq.a} />
            ))}
          </div>
        </div>
      </section>
    );
  }
  
  function FAQItem({ question, answer }: { question: string, answer: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
  
    return (
      <div className={`bg-card/20 transition-all duration-500 ${isOpen ? 'bg-card/30' : 'hover:bg-card/25'} glass-panel-soft rounded-lg`}>
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between p-10 text-left transition-colors"
        >
          <span className="font-mono font-normal tracking-tight text-lg text-foreground">{question}</span>
        <div className={`transition-transform duration-500 ${isOpen ? 'rotate-45 text-primary' : 'text-muted-foreground/40'}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-10 pb-10 text-[14px] text-muted-foreground leading-relaxed font-light">
              {answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
