"use client"

import { useState, useMemo } from "react"
import { MemoriesList } from "./MemoriesList"
import { AddRuleForm } from "./AddRuleForm"

interface Memory {
  id: string
  content: string
  tags: string | null
  type: string | null
  scope: string | null
  created_at: string
}

type ScopeFilter = "all" | "global" | "project"

export function RulesSection({ initialRules }: { initialRules: Memory[] }) {
  const [rules, setRules] = useState(initialRules)
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all")

  const handleAdd = (memory: Memory) => {
    setRules((prev) => [memory, ...prev])
  }

  const handleChange = (updated: Memory[]) => {
    setRules(updated)
  }

  const filteredRules = useMemo(() => {
    if (scopeFilter === "all") return rules
    return rules.filter((r) => r.scope === scopeFilter)
  }, [rules, scopeFilter])

  const globalCount = rules.filter((r) => r.scope === "global").length
  const projectCount = rules.filter((r) => r.scope === "project").length

  // Get unique project scopes for display
  const projectScopes = useMemo(() => {
    const scopes = new Set<string>()
    rules.forEach((r) => {
      if (r.scope && r.scope !== "global") {
        scopes.add(r.scope)
      }
    })
    return Array.from(scopes)
  }, [rules])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Your Rules</h2>
          <p className="text-xs text-muted-foreground mt-1">
            These rules sync to all your AI coding tools
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-2 py-1 border border-border">
            {rules.length} {rules.length === 1 ? "rule" : "rules"}
          </span>
        </div>
      </div>

      {/* Scope Filter Tabs */}
      <div className="flex items-center gap-1 mb-4 p-1 bg-muted/30 border border-border w-fit">
        <button
          onClick={() => setScopeFilter("all")}
          className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors ${
            scopeFilter === "all"
              ? "bg-background text-foreground border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All ({rules.length})
        </button>
        <button
          onClick={() => setScopeFilter("global")}
          className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors ${
            scopeFilter === "global"
              ? "bg-background text-foreground border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Global ({globalCount})
        </button>
        <button
          onClick={() => setScopeFilter("project")}
          className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors ${
            scopeFilter === "project"
              ? "bg-background text-foreground border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Project ({projectCount})
        </button>
      </div>

      {/* Project scopes hint */}
      {scopeFilter === "project" && projectScopes.length > 0 && (
        <div className="mb-4 text-[10px] text-muted-foreground">
          Projects: {projectScopes.map((s) => s.replace("github.com/", "")).join(", ")}
        </div>
      )}

      <div className="space-y-4">
        <AddRuleForm onAdd={handleAdd} />
        
        {filteredRules.length === 0 ? (
          <div className="border border-border bg-card/20 p-8 text-center">
            <p className="text-muted-foreground text-sm">
              {scopeFilter === "all" 
                ? "No rules yet. Click \"Add Rule\" above to create your first rule."
                : `No ${scopeFilter} rules found.`}
            </p>
          </div>
        ) : (
          <MemoriesList initialMemories={filteredRules} onMemoriesChange={handleChange} />
        )}
      </div>
    </div>
  )
}
