"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function FAQ() {
  const faqs = [
    {
      q: "What problem does memories.sh solve?",
      a: "Agents forget and switching tools resets context. memories.sh gives you a durable, local-first state layer so rules and decisions persist, plus recall and native config generation for 13+ tools."
    },
    {
      q: "Can I switch between coding agents easily?",
      a: "Yes. Store state once and generate native configs for each tool. Your context stays consistent, so you do not re-teach every time you switch."
    },
    {
      q: "What's the difference between global and project memory?",
      a: "Global memory is your persistent state across tools and projects. Project memory is repo-specific and auto-scoped via git remote, keeping context aligned with the current codebase."
    },
    {
      q: "Am I locked into memories.sh?",
      a: "No. Export state to JSON or YAML anytime with 'memories export'. Generate native config files for supported tools. Your data stays portable."
    },
    {
      q: "Where is my data stored?",
      a: "All data is stored locally at ~/.config/memories/ on your machine. Cloud sync (Pro) is optional for backup and multi-machine continuity."
    },
    {
      q: "Which coding agents are supported?",
      a: "Cursor, Claude Code, GitHub Copilot, Windsurf, Cline, Roo, Gemini, Amp, Codex, OpenCode, Kilo, Trae, Goose, plus any MCP-compatible client via the built-in server."
    }
  ];

    return (
      <section id="faq" className="py-24 px-6 lg:px-10 border-t border-white/10">
        <div className="max-w-[1000px] mx-auto">
          <div className="mb-16 flex flex-col items-center text-center">
            <div className="text-[10px] uppercase tracking-[0.35em] font-bold text-primary mb-4">Support</div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tighter text-foreground text-gradient">Questions & Answers</h2>
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
  
  function FAQItem({ question, answer }: { question: string, answer: string }) {
    const [isOpen, setIsOpen] = useState(false);
  
    return (
      <div className={`bg-card/20 transition-all duration-500 ${isOpen ? 'bg-card/30' : 'hover:bg-card/25'} glass-panel-soft`}>
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between p-10 text-left transition-colors"
        >
          <span className="font-bold tracking-tight text-lg text-foreground">{question}</span>
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
