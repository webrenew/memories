"use client"

import React, { useEffect, useState, useRef, useCallback } from "react"
import gsap from "gsap"

// ── Shared constants & helpers ────────────────────────────────────────────────

const GLYPHS = "!@#$%^&*()_+-=<>?/\\[]{}Xx"

function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

/** Run a left-to-right scramble reveal using GSAP. */
function runScrambleAnimation(
  text: string,
  duration: number,
  setDisplayText: (text: string) => void,
  onComplete?: () => void,
): gsap.core.Tween {
  const lockedIndices = new Set<number>()
  const finalChars = text.split("")
  const totalChars = finalChars.length
  const scrambleObj = { progress: 0 }

  return gsap.to(scrambleObj, {
    progress: 1,
    duration,
    ease: "power2.out",
    onUpdate: () => {
      const numLocked = Math.floor(scrambleObj.progress * totalChars)

      for (let i = 0; i < numLocked; i++) {
        lockedIndices.add(i)
      }

      const newDisplay = finalChars
        .map((char, i) => {
          if (lockedIndices.has(i)) return char
          if (char === " ") return " "
          return randomGlyph()
        })
        .join("")

      setDisplayText(newDisplay)
    },
    onComplete: () => {
      setDisplayText(text)
      onComplete?.()
    },
  })
}

// ── ScrambleText (animate on mount / when in viewport) ────────────────────────

interface ScrambleTextProps {
  text: string
  className?: string
  /** Delay in milliseconds before animation starts */
  delayMs?: number
  /** Duration of the scramble animation in seconds */
  duration?: number
}

/**
 * Scramble text that animates **once** when the element scrolls into view.
 * Characters lock in left-to-right with scrambled glyphs resolving to final text.
 */
export function ScrambleText({
  text,
  className,
  delayMs = 0,
  duration = 0.9,
}: ScrambleTextProps): React.JSX.Element {
  const [displayText, setDisplayText] = useState(text)
  const hasAnimated = useRef(false)
  const containerRef = useRef<HTMLSpanElement>(null)
  const animationRef = useRef<gsap.core.Tween | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Observe intersection — fire animation once when element enters viewport
  useEffect(() => {
    const el = containerRef.current
    if (!el || hasAnimated.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || hasAnimated.current) return

        hasAnimated.current = true
        observer.disconnect()

        // Show scrambled text immediately
        const scrambledStart = text
          .split("")
          .map((c) => (c === " " ? " " : randomGlyph()))
          .join("")
        setDisplayText(scrambledStart)

        timeoutRef.current = setTimeout(() => {
          animationRef.current = runScrambleAnimation(
            text,
            duration,
            setDisplayText,
            () => {
              animationRef.current = null
            },
          )
        }, delayMs)
      },
      { threshold: 0.15 },
    )

    observer.observe(el)

    return () => {
      observer.disconnect()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (animationRef.current) animationRef.current.kill()
    }
  }, [text, delayMs, duration])

  // Handle text prop changes after animation has completed
  useEffect(() => {
    if (hasAnimated.current && !animationRef.current) {
      setDisplayText(text)
    }
  }, [text])

  return (
    <span ref={containerRef} className={className}>
      {displayText || text}
    </span>
  )
}

// ── ScrambleTextOnHover (animate on mouseenter) ──────────────────────────────

interface ScrambleTextOnHoverProps {
  text: string
  className?: string
  /** Duration of the scramble animation in seconds */
  duration?: number
  onClick?: () => void
}

/**
 * Shows static text by default. On mouseenter, scrambles and resolves
 * left-to-right. Prevents re-triggering while animation is in progress.
 */
export function ScrambleTextOnHover({
  text,
  className,
  duration = 0.4,
  onClick,
}: ScrambleTextOnHoverProps): React.JSX.Element {
  const [displayText, setDisplayText] = useState(text)
  const isAnimating = useRef(false)
  const animationRef = useRef<gsap.core.Tween | null>(null)

  const handleMouseEnter = useCallback(() => {
    if (isAnimating.current) return
    isAnimating.current = true

    // Start fully scrambled
    const scrambled = text
      .split("")
      .map((c) => (c === " " ? " " : randomGlyph()))
      .join("")
    setDisplayText(scrambled)

    animationRef.current = runScrambleAnimation(
      text,
      duration,
      setDisplayText,
      () => {
        isAnimating.current = false
      },
    )
  }, [text, duration])

  // Sync display when text prop changes
  useEffect(() => {
    if (!isAnimating.current) {
      setDisplayText(text)
    }
  }, [text])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) animationRef.current.kill()
    }
  }, [])

  return (
    <span
      className={className}
      onMouseEnter={handleMouseEnter}
      onClick={onClick}
    >
      {displayText || text}
    </span>
  )
}
