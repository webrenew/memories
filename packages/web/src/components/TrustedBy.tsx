"use client";
import React from "react"

import { motion } from "framer-motion";
import { ToolLogo } from "./ui/tool-logo";
import { MARQUEE_TOOLS } from "@/lib/tools";

const marqueeItems = [...MARQUEE_TOOLS, ...MARQUEE_TOOLS, ...MARQUEE_TOOLS];

export function TrustedBy(): React.JSX.Element {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, delay: 0.8 }}
      className="relative w-full px-6 lg:px-9 -mt-8 mb-12 md:mb-20"
    >
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-10">
          {/* Label */}
          <p className="shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60">
            Works with
          </p>

          {/* Marquee */}
          <div className="relative w-full overflow-hidden">
            <div className="relative flex overflow-hidden group">
              <div
                className="flex w-fit items-center whitespace-nowrap"
                style={{ animation: "marquee 60s linear infinite" }}
                data-marquee
              >
                {marqueeItems.map((tool, index) => (
                  <div
                    key={`${tool.name}-${index}`}
                    className="flex shrink-0 items-center gap-2 px-5 lg:px-7 opacity-60 hover:opacity-100 transition-opacity duration-300"
                  >
                    <ToolLogo src={tool.logo} alt={tool.name} size="xs" className="opacity-70" />
                    <span className="font-mono text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
                      {tool.name}
                    </span>
                  </div>
                ))}
              </div>

              {/* Edge fades */}
              <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent z-10" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent z-10" />
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
