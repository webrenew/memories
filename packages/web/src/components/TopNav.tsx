"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import type { User } from "@supabase/supabase-js";
import { ScrambleTextOnHover } from "./animations/ScrambleText";
import { Github } from "./icons/app/Github";
import { useUser } from "@/hooks/use-user";

const navItems = [
  { href: "#how-it-works", label: "How" },
  { href: "#features", label: "Features" },
  { href: "#api", label: "API" },
  { href: "#integrations", label: "Apps" },
  { href: "/docs", label: "Docs" },
  { href: "#faq", label: "FAQ" },
];

export function TopNav({ user }: { user?: User | null }): React.JSX.Element {
  const { user: sessionUser } = useUser();
  const effectiveUser = sessionUser ?? user ?? null;
  const isSignedIn = Boolean(effectiveUser);
  const primaryCtaHref = isSignedIn ? "/app" : "/docs/getting-started";
  const primaryCtaLabel = isSignedIn ? "Dashboard" : "Get Started";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLinkClick = () => {
    setMobileMenuOpen(false);
  };

  return (
    <>
      <motion.nav 
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed top-0 left-0 w-full z-[100] border-b border-white/10 bg-background/60 backdrop-blur-2xl"
      >
        <div className="w-full px-6 lg:px-16 xl:px-24 h-16 flex items-center justify-between">
          {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <Image src="/memories.svg" alt="memories.sh logo" width={32} height={32} className="w-8 h-8 dark:invert group-hover:scale-110 transition-transform duration-500" />
              <span 
                className="text-sm font-bold tracking-[0.2em] uppercase hidden sm:block text-foreground"
                style={{ fontFamily: "var(--font-departure-mono), var(--font-geist-mono), monospace" }}
              >
                memories.sh
              </span>
            </Link>

          {/* Right side: Links + CTA */}
          <div className="flex items-center gap-8">
            <div className="hidden md:flex items-center gap-0">
              {navItems.map((item) => (
                <Link 
                  key={item.href}
                  href={item.href} 
                  className="group relative px-4 py-2 flex items-center gap-2"
                >
                  <ScrambleTextOnHover
                    text={item.label}
                    className="font-mono text-[11px] uppercase tracking-[0.12em] font-normal text-muted-foreground/80 group-hover:text-foreground transition-colors"
                    duration={0.4}
                  />
                  
                  {/* Hover Indicator */}
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-px bg-primary/80 group-hover:w-1/2 transition-all duration-500" />
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-6">
              <a
                href="https://github.com/webrenew/memories"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/80 hover:text-foreground transition-colors"
                aria-label="GitHub"
              >
                <Github className="w-5 h-5" />
              </a>

              {!isSignedIn && (
                <Link
                  href="/login"
                  className="hidden sm:block text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  Sign In
                </Link>
              )}

              <Link
                href={primaryCtaHref}
                className="group hidden sm:flex items-center px-5 py-2 bg-primary/90 text-primary-foreground shadow-[0_0_30px_rgba(99,102,241,0.25)] hover:opacity-90 transition-all duration-300 rounded-md"
              >
                <span className="text-[10px] uppercase tracking-[0.2em] font-bold">{primaryCtaLabel}</span>
              </Link>

              {/* Mobile Menu Toggle */}
              <button 
                className="md:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileMenuOpen}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {mobileMenuOpen ? (
                    <path d="M6 6l12 12M6 18L18 6" />
                  ) : (
                    <path d="M4 8h16M4 16h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[90] bg-background/80 backdrop-blur-sm md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            
            {/* Menu Panel */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="fixed top-20 left-0 right-0 z-[95] bg-background border-b border-white/10 md:hidden"
            >
              <div className="max-w-7xl mx-auto px-6 py-6">
                <div className="flex flex-col gap-2">
                  {navItems.map((item, index) => (
                    <motion.div
                      key={item.href}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Link 
                        href={item.href}
                        onClick={handleLinkClick}
                        className="group flex items-center justify-between py-4 border-b border-border/50 last:border-0"
                      >
                        <span className="text-sm uppercase tracking-[0.15em] font-bold text-muted-foreground group-hover:text-foreground transition-colors">
                          {item.label}
                        </span>
                        <svg 
                          width="16" 
                          height="16" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2"
                          className="text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-1 transition-all"
                        >
                          <path d="M5 12h14m-7-7 7 7-7 7" />
                        </svg>
                      </Link>
                    </motion.div>
                  ))}
                </div>

                {/* Mobile CTA */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="mt-6 pt-6 border-t border-border"
                >
                  <Link
                    href={primaryCtaHref}
                    onClick={handleLinkClick}
                    className="group flex items-center justify-center gap-3 w-full px-6 py-4 bg-foreground text-background hover:bg-primary hover:text-primary-foreground transition-all duration-300 rounded-md"
                  >
                    <span className="text-sm uppercase tracking-[0.15em] font-bold">
                      {primaryCtaLabel}
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14m-7-7 7 7-7 7" />
                    </svg>
                  </Link>

                  {!isSignedIn && (
                    <Link
                      href="/login"
                      onClick={handleLinkClick}
                      className="mt-4 flex items-center justify-center text-xs uppercase tracking-[0.15em] font-bold text-muted-foreground/70 hover:text-foreground transition-colors"
                    >
                      Already have an account? Sign In
                    </Link>
                  )}
                </motion.div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
