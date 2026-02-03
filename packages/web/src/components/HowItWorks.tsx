"use client";

import { motion, useMotionValue, useSpring, useMotionTemplate } from "framer-motion";
import React from "react";

const StepIcon = ({ index }: { index: number }) => {
  const icons = [
    // Define
    <svg key="define" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18M3 12h18" />
      <circle cx="12" cy="12" r="9" strokeDasharray="4 4" />
    </svg>,
    // Scope
    <svg key="scope" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 21L15 15M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z" />
      <path d="M10 7V13M7 10H13" />
    </svg>,
    // Recall
    <svg key="recall" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h20M12 2L2 12l10 10M22 12l-10-10" />
    </svg>
  ];
  return icons[index % icons.length];
};

function StepCard({ step, idx }: { step: { title: string; desc: string; cmd: string }; idx: number }) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Smooth springs for the accent follower
  const springX = useSpring(mouseX, { stiffness: 500, damping: 50 });
  const springY = useSpring(mouseY, { stiffness: 500, damping: 50 });

  function handleMouseMove({ currentTarget, clientX, clientY }: React.MouseEvent) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      onMouseMove={handleMouseMove}
      className="p-10 bg-card/10 border border-border group relative overflow-hidden md:cursor-none"
    >
      {/* Accent Circle (The "Mouse") */}
      <motion.div
        className="pointer-events-none absolute w-12 h-12 rounded-full border border-primary/50 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-30 flex items-center justify-center"
        style={{
          x: springX,
          y: springY,
          translateX: "-50%",
          translateY: "-50%",
        }}
      >
        <div className="w-1 h-1 rounded-full bg-primary" />
      </motion.div>

      {/* Background Spotlight Glow */}
      <motion.div
        className="pointer-events-none absolute -inset-px opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-0"
        style={{
          background: useMotionTemplate`
            radial-gradient(
              250px circle at ${mouseX}px ${mouseY}px,
              var(--primary) 0.08,
              transparent 80%
            )
          `,
        }}
      />

      <div className="relative z-20">
        <div className="text-primary/60 group-hover:text-primary transition-colors duration-500 mb-10">
          <StepIcon index={idx} />
        </div>
        
        <h4 className="text-lg font-bold mb-4 tracking-tight text-foreground uppercase tracking-wider">{step.title}</h4>
        <p className="text-[13px] text-muted-foreground leading-relaxed font-light mb-12">
          {step.desc}
        </p>
        
        <div className="font-mono text-[10px] bg-muted/50 p-4 border border-border text-primary flex items-center justify-between">
          <span>$ {step.cmd}</span>
          <div className="flex gap-1">
            <div className="w-1 h-1 rounded-full bg-primary/40" />
            <div className="w-1 h-1 rounded-full bg-primary/40" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function HowItWorks() {
  const steps = [
    {
      title: "Capture your rules",
      desc: "Store coding standards, decisions, and project context in one place.",
      cmd: "memories add --rule 'Use Tailwind for all styling'"
    },
    {
      title: "Generate for any tool",
      desc: "One command outputs native configs for Cursor, Claude Code, Copilot, and 10+ more.",
      cmd: "memories generate all"
    },
    {
      title: "Switch agents freely",
      desc: "Try a new tool tomorrow. Your context travels with you — no re-teaching required.",
      cmd: "memories generate cursor"
    }
  ];

  return (
    <section id="how-it-works" className="py-32 px-6 border-y border-border bg-muted/20">
      <div className="max-w-6xl mx-auto">
        {/* Social Proof / Momentum Bar */}
        <div className="mb-40 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="md:col-span-1">
            <h3 className="text-xl font-bold tracking-tight text-foreground mb-2 leading-tight">Why developers switch to Memories</h3>
            <div className="w-12 h-1 bg-primary/20" />
          </div>
          <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-12">
            {[
              { label: "Freedom", detail: "Try any agent, keep your context" },
              { label: "No Lock-in", detail: "Export to JSON, YAML, or native files" },
              { label: "Zero Rework", detail: "Switch tools in one command" },
            ].map((item, i) => (
              <div key={i}>
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary mb-2">{item.label}</div>
                <div className="text-sm text-muted-foreground font-light leading-relaxed">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-24 flex flex-col items-center text-center">
          <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-primary mb-4">How It Works</div>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tighter text-foreground">Start in under a minute</h2>
        </div>

        <div className="grid md:grid-cols-3 gap-3 md:gap-1">
          {steps.map((step, idx) => (
            <StepCard key={idx} step={step} idx={idx} />
          ))}
        </div>
      </div>
    </section>
  );
}
