"use client";

import React, { useRef, useState, useEffect } from "react";
import type { RefObject } from "react";
import { cn } from "@/lib/utils";

interface NoiseTextureProps {
  parentRef?: RefObject<HTMLElement | null>;
  className?: string;
  /** If true, always shows at full opacity (no scroll-based fade) */
  staticOpacity?: boolean;
}

export function NoiseTexture({ parentRef, className, staticOpacity = false }: NoiseTextureProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [opacity, setOpacity] = useState(staticOpacity ? 1 : 0);

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

      const grid = 14;
      for (let y = 0; y <= height; y += grid) {
        for (let x = 0; x <= width; x += grid) {
          const i = x / grid;
          const j = y / grid;
          const noise =
            Math.sin(i * 0.15) * Math.cos(j * 0.15) +
            Math.sin((i + j) * 0.08);

          if (noise <= -0.4) continue;

          const alpha = Math.max(0, Math.min(0.2, (noise + 1.5) * 0.08));
          const size = 1.5 + noise * 1;
          
          // Blend between magenta and blue-purple based on position
          const colorMix = (Math.sin(i * 0.25) * Math.cos(j * 0.2) + 1) / 2;
          // Magenta: rgb(180, 50, 200) -> Blue-purple: rgb(120, 80, 220)
          const r = Math.round(180 + (120 - 180) * colorMix);
          const g = Math.round(50 + (80 - 50) * colorMix);
          const b = Math.round(200 + (220 - 200) * colorMix);
          
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
    };

    const updateOpacity = () => {
      if (staticOpacity) {
        setOpacity(1);
        return;
      }
      
      const parent = parentRef?.current;
      if (!parent) {
        setOpacity(1);
        return;
      }
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
      if (!staticOpacity) {
        updateOpacity();
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [parentRef, staticOpacity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 transition-opacity duration-500 z-0 mix-blend-screen",
        className
      )}
      style={{ opacity }}
    />
  );
}
