"use client";
import React from "react"

import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { ScrambleText } from "@/components/animations/ScrambleText";

const ShaderBackground = dynamic(
  () => import("@/components/ShaderBackground").then((mod) => mod.ShaderBackground),
  { ssr: false }
);

const GeometricPattern = ({ className = "" }: { className?: string }) => (
  <svg
    width="400"
    height="400"
    viewBox="0 0 400 400"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none ${className}`}
  >
    <circle cx="200" cy="200" r="150" stroke="currentColor" strokeWidth="0.5" strokeDasharray="4 4" />
    <circle cx="200" cy="200" r="100" stroke="currentColor" strokeWidth="0.5" />
    <path d="M200 50V350M50 200H350" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" />
    <rect x="100" y="100" width="200" height="200" stroke="currentColor" strokeWidth="0.5" strokeDasharray="8 8" />
  </svg>
);

export default function NotFound(): React.JSX.Element {
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
    <main className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <ShaderBackground
        className="opacity-40 z-0"
        color="#b855f7"
        backgroundColor="#0a0a0f"
      />
      {/* Gradient overlay */}
      <div className="absolute inset-0 pointer-events-none z-[1] bg-gradient-to-tr from-background from-50% to-transparent" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <GeometricPattern className="opacity-10 text-primary/40" />
      </motion.div>

      <div className="relative z-10 w-full px-6 flex flex-col items-center text-center">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center max-w-2xl"
        >
          {/* Logo */}
          <motion.div variants={itemVariants}>
            <Link href="/" className="flex items-center gap-3 mb-12 group">
              <Image
                src="/memories.svg"
                alt="memories.sh logo"
                width={32}
                height={32}
                className="w-8 h-8 dark:invert group-hover:scale-110 transition-transform duration-500"
              />
              <span className="font-mono text-sm font-bold tracking-tighter uppercase text-foreground">
                memories.sh
              </span>
            </Link>
          </motion.div>

          {/* 404 Badge */}
          <motion.div variants={itemVariants} className="inline-flex items-center gap-2 mb-6">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase text-muted-foreground">
              Memory Not Found
            </span>
          </motion.div>

          {/* Main heading */}
          <motion.h1
            variants={itemVariants}
            className="font-mono font-normal text-3xl sm:text-4xl lg:text-5xl xl:text-6xl mb-6 leading-[0.95] text-foreground"
          >
            <ScrambleText text="404" delayMs={300} duration={0.8} />
          </motion.h1>

          {/* Description */}
          <motion.p
            variants={itemVariants}
            className="text-lg md:text-xl text-muted-foreground mb-10 max-w-md leading-relaxed font-light"
          >
            This page doesn&apos;t exist in our memory store. It may have been moved, deleted, or never existed.
          </motion.p>

          {/* Actions */}
          <motion.div variants={itemVariants} className="flex flex-col sm:flex-row items-center gap-4">
            <Link
              href="/"
              className="px-6 py-3 bg-foreground text-background font-bold text-xs uppercase tracking-[0.15em] rounded-md hover:bg-primary hover:text-primary-foreground transition-all duration-300"
            >
              Back to Home
            </Link>
            <Link
              href="/docs"
              className="px-6 py-3 border border-border bg-muted/50 text-foreground font-bold text-xs uppercase tracking-[0.15em] rounded-md hover:border-primary/50 transition-all duration-300"
            >
              View Documentation
            </Link>
          </motion.div>

          {/* Terminal-style hint */}
          <motion.div
            variants={itemVariants}
            className="mt-16 flex items-center gap-3 px-4 py-3 bg-foreground/5 border border-border rounded-md font-mono text-sm"
          >
            <span className="text-muted-foreground select-none">$</span>
            <code className="text-foreground/70">memories search &quot;what you were looking for&quot;</code>
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
}
