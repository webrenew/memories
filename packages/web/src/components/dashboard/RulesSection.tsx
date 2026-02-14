"use client"

import React, { useState, useMemo } from "react"
import { ChevronDown } from "lucide-react"
import { MemoriesList } from "./MemoriesList"
import { AddRuleForm } from "./AddRuleForm"
import type { Memory } from "@/types/memory"

type ScopeFilter = "all" | "global" | string // "all", "global", or a specific project_id

function formatProjectName(projectId: string): string {
  // github.com/org/repo -> org/repo
  return projectId.replace(/^github\.com\//, "")
}

function getShortProjectName(projectId: string): string {
  // github.com/org/repo -> repo
  return projectId.replace(/^github\.com\//, "").split("/").pop() || projectId
}

export function RulesSection({ initialRules }: { initialRules: Memory[] }): React.JSX.Element {
  const [rules, setRules] = useState(initialRules)
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all")
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)

  const handleAdd = (memory: Memory) => {
    setRules((prev) => [memory, ...prev])
  }

  const handleDeleteRule = (id: string) => {
    setRules((prev) => prev.filter((rule) => rule.id !== id))
  }

  const handleUpdateRule = (id: string, content: string) => {
    setRules((prev) => prev.map((rule) => (rule.id === id ? { ...rule, content } : rule)))
  }

  // Get unique projects with counts (using project_id, not scope)
  const projectScopes = useMemo(() => {
    const scopeCounts = new Map<string, number>()
    rules.forEach((r) => {
      if (r.scope === "project" && r.project_id) {
        scopeCounts.set(r.project_id, (scopeCounts.get(r.project_id) || 0) + 1)
      }
    })
    return Array.from(scopeCounts.entries())
      .map(([scope, count]) => ({ scope, count }))
      .sort((a, b) => b.count - a.count)
  }, [rules])

  const filteredRules = useMemo(() => {
    if (scopeFilter === "all") return rules
    if (scopeFilter === "global") return rules.filter((r) => r.scope === "global")
    return rules.filter((r) => r.project_id === scopeFilter)
  }, [rules, scopeFilter])

  const globalCount = rules.filter((r) => r.scope === "global").length
  const allProjectCount = rules.filter((r) => r.scope === "project" && r.project_id).length

  // Check if current filter is a specific project
  const isProjectFilter = scopeFilter !== "all" && scopeFilter !== "global"

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
        
        {/* Project dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowProjectDropdown(!showProjectDropdown)}
            className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors flex items-center gap-1 ${
              isProjectFilter
                ? "bg-background text-foreground border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {isProjectFilter ? getShortProjectName(scopeFilter) : `Projects (${allProjectCount})`}
            <ChevronDown className="w-3 h-3" />
          </button>
          
          {showProjectDropdown && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setShowProjectDropdown(false)} 
              />
              <div className="absolute top-full left-0 mt-1 bg-background border border-border shadow-lg z-20 min-w-[200px] max-h-[300px] overflow-y-auto">
                <button
                  onClick={() => {
                    setScopeFilter("all")
                    setShowProjectDropdown(false)
                  }}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors flex items-center justify-between"
                >
                  <span>All Projects</span>
                  <span className="text-muted-foreground">{allProjectCount}</span>
                </button>
                <div className="border-t border-border" />
                {projectScopes.map(({ scope, count }) => (
                  <button
                    key={scope}
                    onClick={() => {
                      setScopeFilter(scope)
                      setShowProjectDropdown(false)
                    }}
                    className={`w-full px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors flex items-center justify-between ${
                      scopeFilter === scope ? "bg-muted/30" : ""
                    }`}
                  >
                    <span className="truncate" title={scope}>
                      {formatProjectName(scope)}
                    </span>
                    <span className="text-muted-foreground ml-2 shrink-0">{count}</span>
                  </button>
                ))}
                {projectScopes.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No project-scoped rules
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Current filter indicator for specific project */}
      {isProjectFilter && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Filtering:</span>
          <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-[10px] tracking-wider font-bold text-amber-400">
            {formatProjectName(scopeFilter)}
          </span>
          <button
            onClick={() => setScopeFilter("all")}
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
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
          <MemoriesList 
            memories={filteredRules}
            onDeleteMemory={handleDeleteRule}
            onUpdateMemory={handleUpdateRule}
            onFilterByProject={(scope) => setScopeFilter(scope)}
          />
        )}
      </div>
    </div>
  )
}
