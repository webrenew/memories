"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import type { RefObject } from "react";
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

const GeometricPattern = ({ className = "" }: { className?: string }) => (
  <svg width="400" height="400" viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg" className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none ${className}`}>
    <circle cx="200" cy="200" r="150" stroke="currentColor" strokeWidth="0.5" strokeDasharray="4 4" />
    <circle cx="200" cy="200" r="100" stroke="currentColor" strokeWidth="0.5" />
    <path d="M200 50V350M50 200H350" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" />
    <rect x="100" y="100" width="200" height="200" stroke="currentColor" strokeWidth="0.5" strokeDasharray="8 8" />
  </svg>
);

function NoiseTexture({ parentRef }: { parentRef: RefObject<HTMLElement> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const grid = 12;
      for (let y = 0; y <= height; y += grid) {
        for (let x = 0; x <= width; x += grid) {
          const i = x / grid;
          const j = y / grid;
          const noise =
            Math.sin(i * 0.2) * Math.cos(j * 0.2) +
            Math.sin((i + j) * 0.1);

          if (noise <= -0.3) continue;

          const alpha = Math.max(0, Math.min(0.25, (noise + 1.5) * 0.1));
          const size = 2 + noise * 1.5;
          ctx.fillStyle = `rgba(99, 102, 241, ${alpha})`;
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
    };

    const updateOpacity = () => {
      const parent = parentRef.current;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const viewportHeight = window.innerHeight || 1;
      const progress = Math.max(0, Math.min(1, 1 - rect.top / viewportHeight));
      setOpacity(progress);
    };

    const timeout = window.setTimeout(() => {
      draw();
      updateOpacity();
    }, 100);

    const handleResize = () => {
      draw();
      updateOpacity();
    };

    const handleScroll = () => {
      updateOpacity();
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [parentRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 transition-opacity duration-500 z-0 mix-blend-screen"
      style={{ opacity }}
    />
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
    <section ref={sectionRef} className="relative min-h-screen overflow-hidden pt-28 pb-20">
      <NoiseTexture parentRef={sectionRef} />
      <div className="pointer-events-none absolute inset-0 home-ambient opacity-70" />
      <div className="pointer-events-none absolute inset-0 home-vignette" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <GeometricPattern className="opacity-10 text-primary/40" />
      </motion.div>

      <div className="relative z-10 w-full max-w-[1400px] mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="flex flex-col items-start text-left"
          >
            <motion.div variants={itemVariants} className="inline-flex items-center gap-3 px-3 py-1 bg-white/5 border border-white/10 text-[10px] uppercase tracking-[0.25em] font-bold mb-8 text-foreground/90">
              <span className="w-1.5 h-1.5 bg-primary animate-pulse" />
              Stop Re-Teaching Agents
            </motion.div>

            <motion.h1 variants={itemVariants} className="text-4xl sm:text-6xl lg:text-[88px] font-bold tracking-[-0.04em] mb-8 leading-[0.92] text-foreground">
              Agents Forget. <br />
              <span className="text-primary/85 italic font-light">Durable State Fixes It.</span>
            </motion.h1>

            <motion.p variants={itemVariants} className="text-lg md:text-xl text-muted-foreground mb-10 max-w-xl leading-relaxed font-light">
              Durable, local-first state for coding agents. Store rules once, recall context, and generate native configs for every tool; offline by default, sync when you need it.
            </motion.p>

            <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-4">
              <a href="#quickstart" className="relative px-8 py-4 bg-primary text-primary-foreground font-bold uppercase tracking-[0.2em] text-[11px] shadow-[0_0_40px_rgba(99,102,241,0.35)] transition-all hover:translate-y-[-1px]">
                Get Started
              </a>

              <a href="#pricing" className="px-6 py-4 border border-white/15 bg-white/5 text-[11px] font-bold uppercase tracking-[0.2em] text-foreground/80 hover:text-foreground transition-colors">
                View Pricing
              </a>
            </motion.div>
          </motion.div>

          <motion.div
            variants={itemVariants}
            initial="hidden"
            animate="visible"
            className="glass-panel p-6 md:p-8 lg:p-10 relative overflow-hidden"
          >
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/5 via-transparent to-transparent" />
            <div className="relative z-10 space-y-6">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground">
                <span>Live State</span>
                <span className="px-2 py-0.5 rounded-full border border-white/10 text-primary/80">Local</span>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/40">
                <div className="px-4 py-3 text-xs text-muted-foreground">
                  Ask your agent to pick up where you left off...
                </div>
                <div className="border-t border-white/10 px-4 py-3 text-[11px] text-foreground/80">
                  &ldquo;Continue the auth refactor with the same error-handling rules.&rdquo;
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground">
                  Recent Context
                </div>
                {[
                  "Use Tailwind for all UI components",
                  "Prefer zod over joi for validation",
                  "Keep auth logic in /lib/auth.ts",
                ].map((item) => (
                  <div key={item} className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground/80">
                    <span>{item}</span>
                    <span className="text-[9px] uppercase tracking-[0.2em] text-primary/70">Stored</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground">
                <span className="h-1 w-1 rounded-full bg-primary/80" />
                Recall and generate configs in one command
              </div>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.1, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mt-16 lg:mt-20 flex flex-col lg:flex-row items-start lg:items-center gap-6 lg:gap-10 border-t border-white/10 pt-8"
        >
          <p className="shrink-0 text-[10px] uppercase tracking-[0.3em] font-bold text-muted-foreground/70">
            Trusted by
          </p>
          <div className="relative w-full overflow-hidden">
            <div className="flex overflow-hidden">
              <div
                className="flex w-fit items-center whitespace-nowrap"
                style={{ animation: "marquee 50s linear infinite" }}
                data-marquee
              >
                {marqueeTools.map((tool, index) => (
                  <div
                    key={`${tool.name}-${index}`}
                    className="flex shrink-0 items-center gap-3 px-6 opacity-70 hover:opacity-100 transition-opacity duration-300"
                  >
                    <Image
                      src={tool.logo}
                      alt={tool.name}
                      width={24}
                      height={24}
                      className="w-6 h-6 opacity-80"
                    />
                    <span className="font-mono text-[12px] uppercase tracking-[0.2em] text-muted-foreground">
                      {tool.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent z-10" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent z-10" />
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
