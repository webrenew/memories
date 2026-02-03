"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import Image from "next/image";

const tools = [
  { name: "Cursor", logo: "/logos/cursor.svg" },
  { name: "Claude Code", logo: "/logos/claude-code.svg" },
  { name: "Copilot", logo: "/logos/copilot.svg" },
  { name: "Windsurf", logo: "/logos/windsurf.svg" },
  { name: "Cline", logo: "/logos/cline.svg" },
  { name: "Codex", logo: "/logos/codex.svg" },
  { name: "Gemini", logo: "/logos/gemini.svg" },
  { name: "Roo", logo: "/logos/roo.svg" },
  { name: "OpenCode", logo: "/logos/opencode.svg" },
  { name: "Kilo", logo: "/logos/kilo.svg" },
  { name: "Amp", logo: "/logos/amp.svg" },
  { name: "Trae", logo: "/logos/trae.svg" },
  { name: "Goose", logo: "/logos/goose.svg" },
];

const marqueeTools = [...tools, ...tools, ...tools];

const MemoryStream = () => {
  const [memories, setMemories] = useState<Array<{ id: number; hash: string; addr: string; status: string }>>([]);

  useEffect(() => {
    const generateMemory = (id: number) => ({
      id,
      hash: Math.random().toString(36).substring(7).toUpperCase(),
      addr: `0x${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
      status: Math.random() > 0.6 ? "RECALL_OK" : Math.random() > 0.3 ? "SYNC_NODE" : "MEMORY_STORE",
    });

    setMemories(Array.from({ length: 18 }, (_, i) => generateMemory(i)));

    let counter = 18;
    const interval = setInterval(() => {
      setMemories(prev => {
        const next = [...prev, generateMemory(counter++)];
        return next.slice(-18);
      });
    }, 1200);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col gap-3 font-mono text-[9px] leading-normal h-full">
      <AnimatePresence mode="popLayout" initial={false}>
        {memories.map((m) => (
          <motion.div
            key={m.id}
            layout
            initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
            transition={{ 
              duration: 0.8,
              ease: [0.16, 1, 0.3, 1]
            }}
            className="flex justify-between overflow-hidden whitespace-nowrap border-b border-border/10 pb-1"
          >
            <span className="text-primary/60">{m.hash}</span>
            <span className="text-foreground/20">{m.addr}</span>
            <span className={m.status === "RECALL_OK" ? "text-primary/80" : "text-muted-foreground/50"}>
              {m.status}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

const GeometricPattern = () => (
  <svg width="400" height="400" viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20 pointer-events-none">
    <circle cx="200" cy="200" r="150" stroke="currentColor" strokeWidth="0.5" strokeDasharray="4 4" />
    <circle cx="200" cy="200" r="100" stroke="currentColor" strokeWidth="0.5" />
    <path d="M200 50V350M50 200H350" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" />
    <rect x="100" y="100" width="200" height="200" stroke="currentColor" strokeWidth="0.5" strokeDasharray="8 8" />
  </svg>
);

export function Hero() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0, filter: "blur(8px)" },
    visible: {
      y: 0,
      opacity: 1,
      filter: "blur(0px)",
      transition: {
        duration: 1,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      },
    },
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center pt-32 pb-24 px-6 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <GeometricPattern />
      </motion.div>
      
      <div className="max-w-5xl w-full relative z-10 text-center">
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center"
        >
            <motion.div variants={itemVariants} className="inline-flex items-center gap-3 px-3 py-1 bg-muted/50 border border-border text-[10px] uppercase tracking-[0.2em] font-bold mb-10 text-foreground">
              <span className="w-1.5 h-1.5 bg-primary animate-pulse" />
              Switch Tools Freely
            </motion.div>
            
            <motion.h1 variants={itemVariants} className="text-5xl sm:text-7xl md:text-[120px] font-bold tracking-[-0.04em] mb-10 leading-[0.85] text-foreground">
              One Memory <br />
              <span className="text-primary/80 italic font-light">Every AI Tool</span>
            </motion.h1>
            
            <motion.p variants={itemVariants} className="text-xl md:text-2xl text-muted-foreground mb-16 max-w-2xl leading-relaxed font-light tracking-tight">
              Stop re-teaching every coding agent. Store your rules once, generate native configs for Cursor, Claude Code, Copilot, and 10+ more.
            </motion.p>
            
            <motion.div variants={itemVariants} className="flex flex-wrap items-center justify-center gap-8">
              <a href="#quickstart" className="group relative px-10 py-5 bg-foreground text-background font-bold uppercase tracking-[0.1em] text-xs overflow-hidden transition-all hover:scale-[1.02]">
                <span className="relative z-10">Get Started</span>
                <div className="absolute inset-0 bg-primary translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              </a>
              
              <a href="#pricing" className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors">
                View Pricing
              </a>
            </motion.div>
          </motion.div>
  
          {/* Works With Section - Marquee */}
          <motion.div 
            initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.2, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mt-24 pt-12 border-t border-border w-full"
          >
            <p className="text-xs uppercase tracking-[0.3em] font-bold text-muted-foreground mb-8">
              Works with
            </p>
            <div className="relative w-full overflow-hidden">
              <div className="flex overflow-hidden">
                <div
                  className="flex w-fit items-center whitespace-nowrap"
                  style={{ animation: "marquee 40s linear infinite" }}
                >
                  {marqueeTools.map((tool, index) => (
                    <div
                      key={`${tool.name}-${index}`}
                      className="flex shrink-0 items-center gap-4 px-10 opacity-70 hover:opacity-100 transition-opacity duration-300"
                    >
                      <Image
                        src={tool.logo}
                        alt={tool.name}
                        width={40}
                        height={40}
                        className="w-10 h-10"
                      />
                      <span className="font-mono text-lg md:text-xl uppercase tracking-wide text-muted-foreground">
                        {tool.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent z-10" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent z-10" />
            </div>
          </motion.div>

      </div>

      {/* Side Ambient Data Stream */}
      <div className="hidden lg:block absolute right-10 top-1/2 -translate-y-1/2 w-64 h-96 pointer-events-none">
        <MemoryStream />
      </div>
    </section>
  );
}
