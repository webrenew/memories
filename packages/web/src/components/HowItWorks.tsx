"use client";

import { motion, useMotionValue, useMotionTemplate } from "framer-motion";
import { useRef } from "react";
import { NoiseTexture } from "./NoiseTexture";

interface ProblemItem {
  pain: string;
  resolution: string;
  detail: string;
}

function ProblemCard({ item, idx }: { item: ProblemItem; idx: number }) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function handleMouseMove({ currentTarget, clientX, clientY }: React.MouseEvent) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: idx * 0.1 }}
      onMouseMove={handleMouseMove}
      className="p-8 lg:p-10 border border-white/10 bg-white/[0.02] group relative overflow-hidden rounded-lg flex flex-col hover:border-white/20 transition-colors duration-300"
    >
      {/* Background Spotlight Glow */}
      <motion.div
        className="pointer-events-none absolute -inset-px opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-0"
        style={{
          background: useMotionTemplate`
            radial-gradient(
              300px circle at ${mouseX}px ${mouseY}px,
              var(--primary) 0.06,
              transparent 70%
            )
          `,
        }}
      />

      <div className="relative z-20 flex flex-col h-full">
        {/* Pain as italic quote */}
        <p className="text-muted-foreground/70 text-sm italic mb-8 leading-relaxed">
          &ldquo;{item.pain}&rdquo;
        </p>

        {/* Resolution headline */}
        <h4 className="text-2xl font-bold tracking-tight text-foreground mb-4 mt-auto">{item.resolution}</h4>
        
        {/* Detail */}
        <p className="text-sm text-muted-foreground font-light leading-relaxed">
          {item.detail}
        </p>
      </div>
    </motion.div>
  );
}

export function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null);
  
  const problems: ProblemItem[] = [
    {
      pain: "You explain the same rules every session",
      resolution: "Store once, recall forever",
      detail: "Your preferences persist across every conversation. No more repeating yourself.",
    },
    {
      pain: "Agents lose track mid-project",
      resolution: "Context that never dies",
      detail: "Durable state survives restarts, updates, and even tool switches.",
    },
    {
      pain: "Switching tools means starting over",
      resolution: "Your rules travel with you",
      detail: "Generate native configs for Cursor, Claude Code, Copilot, and more. Zero lock-in.",
    },
  ];

  return (
    <section 
      ref={sectionRef}
      id="how-it-works" 
      className="relative py-28 border-y border-white/10 flex flex-col overflow-hidden"
    >
      {/* 2D Noise Background - muted */}
      <div className="absolute inset-0 opacity-25">
        <NoiseTexture parentRef={sectionRef} />
      </div>
      
      {/* Gradient overlay: bg top-right, transparent bottom-left */}
      <div className="absolute inset-0 pointer-events-none z-[1] bg-gradient-to-bl from-background from-50% to-transparent" />

      <div className="relative z-10 w-full px-6 lg:px-16 xl:px-24 flex-1 flex flex-col">
        {/* Section Header */}
        <div className="mb-16 max-w-3xl">
          <div className="text-[11px] uppercase tracking-[0.35em] font-bold text-primary mb-6">The Problem</div>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground leading-[1.1]">
            Agents forget.<br />
            <span className="text-primary">Memories remembers.</span>
          </h2>
          <p className="mt-6 text-lg text-muted-foreground font-light max-w-xl leading-relaxed">
            Every coding agent starts fresh. Your rules, preferences, and project context—gone. 
            Until now.
          </p>
        </div>

        {/* Problem → Solution Cards */}
        <div className="grid md:grid-cols-3 gap-4">
          {problems.map((item, idx) => (
            <ProblemCard key={idx} item={item} idx={idx} />
          ))}
        </div>

        {/* CTA */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="pt-16 flex flex-col items-center text-center"
        >
          <p className="text-muted-foreground mb-6 text-lg font-light">
            Ready to stop repeating yourself?
          </p>
          <a 
            href="#quickstart" 
            className="inline-flex items-center gap-3 px-8 py-4 bg-primary text-primary-foreground font-bold uppercase tracking-[0.2em] text-[11px] rounded-md hover:translate-y-[-1px] transition-transform"
          >
            Get Started
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
        </motion.div>
      </div>
    </section>
  );
}
