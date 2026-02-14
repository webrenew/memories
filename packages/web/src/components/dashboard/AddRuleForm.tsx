"use client"

import React, { useState } from "react"
import { Plus } from "lucide-react"
import type { Memory } from "@/types/memory"

export function AddRuleForm({ onAdd }: { onAdd: (memory: Memory) => void }): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState("")
  const [scope, setScope] = useState<"global" | "project">("global")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          content: content.trim(), 
          type: "rule", 
          scope 
        }),
      })

      if (res.ok) {
        const memory = await res.json()
        onAdd(memory)
        setContent("")
        setIsOpen(false)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all text-xs uppercase tracking-wider font-bold"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Rule
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="border border-primary/30 bg-card/20 p-5">
      <div className="mb-4">
        <label className="block text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
          Rule Content
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="e.g., Always use TypeScript strict mode"
          className="w-full bg-background border border-border px-4 py-3 text-sm focus:outline-none focus:border-primary/50 resize-none"
          rows={3}
          autoFocus
        />
      </div>

      <div className="mb-4">
        <label className="block text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
          Scope
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setScope("global")}
            className={`px-4 py-2 text-xs uppercase tracking-wider font-bold border transition-all ${
              scope === "global"
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Global (all projects)
          </button>
          <button
            type="button"
            onClick={() => setScope("project")}
            className={`px-4 py-2 text-xs uppercase tracking-wider font-bold border transition-all ${
              scope === "project"
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Project-specific
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting || !content.trim()}
          className="px-4 py-2 bg-primary text-primary-foreground text-xs uppercase tracking-wider font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
        >
          {isSubmitting ? "Adding..." : "Add Rule"}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false)
            setContent("")
          }}
          className="px-4 py-2 border border-border text-muted-foreground text-xs uppercase tracking-wider font-bold hover:text-foreground transition-all"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
