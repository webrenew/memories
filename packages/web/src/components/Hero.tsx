"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

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
    <div className="flex flex-col gap-4 font-mono text-[9px] leading-none h-full">
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
            <span className="text-primary/40">{m.hash}</span>
            <span className="text-foreground/10">{m.addr}</span>
            <span className={m.status === "RECALL_OK" ? "text-primary/60" : "text-muted-foreground/30"}>
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
              Open Source CLI
            </motion.div>
            
            <motion.h1 variants={itemVariants} className="text-5xl sm:text-7xl md:text-[120px] font-bold tracking-[-0.04em] mb-10 leading-[0.85] text-foreground">
              One Memory <br />
              <span className="text-primary/80 italic font-light">Every AI Tool</span>
            </motion.h1>
            
            <motion.p variants={itemVariants} className="text-xl md:text-2xl text-muted-foreground mb-16 max-w-2xl leading-relaxed font-light tracking-tight">
              Store your coding rules and context once. Generate native rule files for Cursor, Claude Code, Copilot, and 5+ more — all from the terminal.
            </motion.p>
            
            <motion.div variants={itemVariants} className="flex flex-wrap items-center justify-center gap-8">
              <a href="#quickstart" className="group relative px-10 py-5 bg-foreground text-background font-bold uppercase tracking-[0.1em] text-xs overflow-hidden transition-all hover:scale-[1.02]">
                <span className="relative z-10">Get Started</span>
                <div className="absolute inset-0 bg-primary translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              </a>
              
              <a href="#pricing" className="group flex items-center gap-4 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors">
                <span className="w-12 h-px bg-border group-hover:w-16 group-hover:bg-primary transition-all duration-500" />
                View Pricing
              </a>
            </motion.div>
          </motion.div>
  
          {/* Technical Visualization Layer */}
          <motion.div 
            initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.2, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mt-24 grid grid-cols-1 sm:grid-cols-3 gap-1 border-t border-border"
          >
            {[
              { label: "Tools", value: "8+", detail: "Supported IDE targets" },
              { label: "Commands", value: "20", detail: "Full CLI toolkit" },
              { label: "Format", value: "Open", detail: "JSON, YAML, SQLite" },
            ].map((stat, i) => (
              <div key={i} className="py-8 md:px-8 first:pl-0 border-b md:border-b-0 md:border-r border-border last:border-0">
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground mb-2">{stat.label}</div>
                <div className="text-3xl font-mono mb-1 text-foreground">{stat.value}</div>
                <div className="text-[11px] text-muted-foreground/40 italic">{stat.detail}</div>
              </div>
            ))}
          </motion.div>

      </div>

      {/* Side Ambient Data Stream */}
      <div className="hidden lg:block absolute right-10 top-1/2 -translate-y-1/2 w-64 h-96 pointer-events-none">
        <MemoryStream />
      </div>
    </section>
  );
}
