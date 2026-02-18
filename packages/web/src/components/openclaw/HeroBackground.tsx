"use client";

import dynamic from "next/dynamic";
import React from "react";

const ShaderBackground = dynamic(
  () => import("@/components/ShaderBackground").then((mod) => mod.ShaderBackground),
  { ssr: false },
);

export function OpenClawHeroBackground(): React.JSX.Element {
  return (
    <>
      <ShaderBackground className="opacity-38 z-0" color="#b855f7" backgroundColor="#07080f" />

      {/* Variation from homepage: layered radial wash + directional fade */}
      <div
        className="absolute inset-0 pointer-events-none z-[1]"
        style={{
          background:
            "radial-gradient(70% 55% at 78% 24%, rgba(168,85,247,0.18), transparent 72%), radial-gradient(62% 54% at 22% 82%, rgba(16,185,129,0.10), transparent 74%)",
        }}
      />
      <div className="absolute inset-0 pointer-events-none z-[1] bg-gradient-to-br from-background/90 via-background/62 to-transparent" />
    </>
  );
}
