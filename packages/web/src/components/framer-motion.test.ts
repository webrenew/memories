import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { AnimatePresence, motion } from "framer-motion"
import { describe, expect, it } from "vitest"
import { FAQ } from "./FAQ"

describe("Framer Motion 13 server rendering", () => {
  it("renders the real FAQ with answers initially collapsed", () => {
    const html = renderToString(createElement(FAQ))
    expect(html).toContain("Questions &amp; Answers")
    expect(html).toContain("What problem does memories.sh solve?")
    expect(html).not.toContain("Agents forget and switching tools resets context")
    expect(html).not.toMatch(/\s(?:initial|animate|exit|whileinview|viewport)=/i)
  })

  it("keeps animation-only props off native DOM elements without Emotion injection", () => {
    const html = renderToString(createElement(motion.button, {
      initial: false,
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      whileHover: { scale: 1.02 },
      whileTap: { scale: 0.98 },
      layout: true,
      transition: { duration: 0.2 },
      "aria-label": "Toggle menu",
      children: "Menu",
    }))
    expect(html).toContain('aria-label="Toggle menu"')
    expect(html).toContain("opacity:1")
    expect(html).not.toMatch(/\s(?:initial|animate|exit|whilehover|whiletap|layout|transition)=/i)
  })

  it("preserves initial styles for presence and viewport animations", () => {
    const html = renderToString(createElement(AnimatePresence, null,
      createElement(motion.div, {
        key: "panel",
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true },
        children: "Panel",
      }),
    ))
    expect(html).toContain("opacity:0")
    expect(html).toContain("translateY(20px)")
    expect(html).toContain("Panel")
  })
})
