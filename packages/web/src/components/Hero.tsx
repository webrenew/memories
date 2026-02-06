"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { ScrambleText } from "./animations/ScrambleText";

const ShaderBackground = dynamic(
  () => import("./ShaderBackground").then((mod) => mod.ShaderBackground),
  { ssr: false }
);

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
  { name: "Blackbox", logo: "/logos/blackbox.svg" },
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

const GeometricPattern = ({ className = "" }: { className?: string }) => (
  <svg width="400" height="400" viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg" className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none ${className}`}>
    <circle cx="200" cy="200" r="150" stroke="currentColor" strokeWidth="0.5" strokeDasharray="4 4" />
    <circle cx="200" cy="200" r="100" stroke="currentColor" strokeWidth="0.5" />
    <path d="M200 50V350M50 200H350" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" />
    <rect x="100" y="100" width="200" height="200" stroke="currentColor" strokeWidth="0.5" strokeDasharray="8 8" />
  </svg>
);

// NoiseTexture moved to ./NoiseTexture.tsx

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText("pnpm add -g @memories.sh/cli");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  return (
    <motion.div 
      initial={{ y: 20, opacity: 0, filter: "blur(8px)" }}
      animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 1, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-3 px-4 py-3 bg-foreground/5 border border-border rounded-md font-mono text-sm">
        <span className="text-muted-foreground select-none">$</span>
        <code className="text-foreground">pnpm add -g @memories.sh/cli</code>
        <button 
          onClick={handleCopy}
          className="ml-auto transition-colors"
          title={copied ? "Copied!" : "Copy to clipboard"}
        >
          {copied ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-secondary">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground hover:text-foreground">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>
          )}
        </button>
      </div>
    </motion.div>
  );
}

export function Hero() {
  const sectionRef = useRef<HTMLElement | null>(null);
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
    <section ref={sectionRef} className="relative min-h-screen flex items-center overflow-hidden pt-24 pb-16">
      <ShaderBackground 
        className="opacity-40 z-0" 
        color="#b855f7" 
        backgroundColor="#0a0a0f" 
      />
      {/* Gradient overlay: bg bottom-left, transparent top-right */}
      <div 
        className="absolute inset-0 pointer-events-none z-[1] bg-gradient-to-tr from-background from-50% to-transparent"
      />
      {/* NoiseTexture kept for reuse elsewhere */}
      {/* <NoiseTexture parentRef={sectionRef} /> */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <GeometricPattern className="opacity-10 text-primary/40" />
      </motion.div>

      <div className="relative z-10 w-full px-6 lg:px-16 xl:px-24 flex flex-col min-h-[calc(100vh-160px)]">
        <div className="flex-1 flex items-center">
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center w-full">
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="flex flex-col items-start text-left"
            >
            <motion.div variants={itemVariants} className="inline-flex items-center gap-2 mb-6">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">Stop Re-Teaching Agents</span>
            </motion.div>

            <motion.h1 
              variants={itemVariants} 
              className="font-mono font-normal text-3xl sm:text-4xl lg:text-5xl xl:text-6xl tracking-tight mb-6 leading-[0.95] text-foreground"
            >
              <ScrambleText text="The unified agent memory layer." delayMs={300} duration={1.2} />
            </motion.h1>

            <motion.p variants={itemVariants} className="text-lg md:text-xl text-muted-foreground mb-8 max-w-xl leading-relaxed font-light">
              Durable, local-first state for coding agents. Store rules once, recall context, and generate native configs for every tool; offline by default, sync when you need it.
            </motion.p>

            <CopyCommand />
            </motion.div>

            <motion.div
              variants={itemVariants}
              initial="hidden"
              animate="visible"
              className="glass-panel p-6 md:p-8 lg:p-10 relative overflow-hidden rounded-lg"
            >
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-foreground/5 via-transparent to-transparent" />
              <div className="relative z-10 space-y-6">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.25em] font-bold text-muted-foreground">
                  <span>Live State</span>
                  <span className="px-2 py-0.5 rounded-full border border-border text-accent-secondary">Local</span>
                </div>

                <div className="rounded-lg border border-border bg-card/60">
                  <div className="px-4 py-3 text-xs text-muted-foreground">
                    Ask your agent to pick up where you left off...
                  </div>
                  <div className="border-t border-border px-4 py-3 text-[11px] text-foreground/80">
                    &ldquo;Continue the auth refactor with the same error-handling rules.&rdquo;
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-[11px] uppercase tracking-[0.25em] font-bold text-muted-foreground">
                    Recent Context
                  </div>
                  {[
                    "Use Tailwind for all UI components",
                    "Prefer zod over joi for validation",
                    "Keep auth logic in /lib/auth.ts",
                  ].map((item, index) => (
                    <motion.div 
                      key={item} 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ 
                        duration: 0.6, 
                        delay: 1.2 + index * 0.15,
                        ease: [0.16, 1, 0.3, 1]
                      }}
                      className="flex items-center justify-between gap-4 rounded-md border border-border bg-foreground/5 px-3 py-2 text-xs text-foreground/80"
                    >
                      <span>{item}</span>
                      <span className="text-[10px] uppercase tracking-[0.2em] text-accent-secondary">Stored</span>
                    </motion.div>
                  ))}
                </div>

                <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.25em] font-bold text-muted-foreground">
                  <span className="h-1 w-1 rounded-full bg-accent-secondary" />
                  Recall and generate configs in one command
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.1, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center pt-8"
        >
          <div className="inline-flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">Works with</span>
          </div>
          <div className="relative overflow-hidden">
            <div className="flex overflow-hidden">
              <div
                className="flex w-fit items-center whitespace-nowrap"
                style={{ animation: "marquee 30s linear infinite" }}
                data-marquee
              >
                {marqueeTools.map((tool, index) => (
                  <div
                    key={`${tool.name}-${index}`}
                    className="flex shrink-0 items-center px-6 opacity-70 hover:opacity-100 transition-opacity duration-300"
                  >
                    <Image
                      src={tool.logo}
                      alt={tool.name}
                      width={56}
                      height={56}
                      className="w-14 h-14 opacity-90 dark:invert-0 invert"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-background to-transparent z-10" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent z-10" />
          </div>
        </motion.div>
      </div>

      {/* Side Ambient Data Stream */}
      <div className="hidden absolute right-10 top-1/2 -translate-y-1/2 w-64 h-96 pointer-events-none">
        <MemoryStream />
      </div>
    </section>
  );
}
