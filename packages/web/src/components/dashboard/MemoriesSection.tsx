"use client"

import React, { useState, useMemo, useEffect } from "react"
import { ChevronDown, Search } from "lucide-react"
import { MemoriesList } from "./MemoriesList"
import { AddRuleForm } from "./AddRuleForm"
import type { Memory } from "@/types/memory"
import type { ApplyMemoryInsightActionResult } from "@/lib/memory-insight-actions"

type TypeFilter = "all" | "rule" | "decision" | "fact" | "note" | "skill"
type ScopeFilter = "all" | "global" | string
const LOAD_MORE_PAGE_SIZE = 50

const TYPE_OPTIONS: { value: TypeFilter; label: string; color: string }[] = [
  { value: "all", label: "All Types", color: "" },
  { value: "rule", label: "Rules", color: "text-primary" },
  { value: "skill", label: "Skills", color: "text-purple-400" },
  { value: "note", label: "Notes", color: "text-cyan-400" },
  { value: "decision", label: "Decisions", color: "text-amber-400" },
  { value: "fact", label: "Facts", color: "text-pink-400" },
]

function formatProjectName(scope: string): string {
  return scope.replace(/^github\.com\//, "")
}

function getShortProjectName(scope: string): string {
  return scope.replace(/^github\.com\//, "").split("/").pop() || scope
}

function normalizeMemory(memory: Partial<Memory> & { id: string; content: string; created_at: string }): Memory {
  return {
    id: memory.id,
    content: memory.content,
    tags: memory.tags ?? null,
    type: (memory.type as Memory["type"]) ?? "note",
    scope: (memory.scope as Memory["scope"]) ?? "global",
    project_id: memory.project_id ?? null,
    paths: memory.paths ?? null,
    category: memory.category ?? null,
    metadata: memory.metadata ?? null,
    created_at: memory.created_at,
    updated_at: memory.updated_at ?? memory.created_at,
  }
}

export function MemoriesSection({
  initialMemories,
  initialHasMore,
}: {
  initialMemories: Memory[]
  initialHasMore: boolean
}): React.JSX.Element {
  const [memories, setMemories] = useState(initialMemories)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)

  useEffect(() => {
    function onInsightApplied(event: Event) {
      if (!(event instanceof CustomEvent)) return
      const detail = (event as CustomEvent<ApplyMemoryInsightActionResult>).detail
      if (!detail) return

      setMemories((previous) => {
        const archivedSet = new Set(detail.archivedIds)
        const tagsById = new Map(detail.updatedTags.map((entry) => [entry.id, entry.tags]))

        return previous
          .filter((memory) => !archivedSet.has(memory.id))
          .map((memory) => {
            if (!tagsById.has(memory.id)) return memory
            return {
              ...memory,
              tags: tagsById.get(memory.id) ?? null,
            }
          })
      })
    }

    window.addEventListener("memories:insight-action-applied", onInsightApplied)
    return () => {
      window.removeEventListener("memories:insight-action-applied", onInsightApplied)
    }
  }, [])

  const handleAdd = (memory: Memory) => {
    setMemories((prev) => [memory, ...prev])
  }

  const handleDeleteMemory = (id: string) => {
    setMemories((prev) => prev.filter((memory) => memory.id !== id))
  }

  const handleUpdateMemory = (id: string, content: string) => {
    setMemories((prev) =>
      prev.map((memory) => (memory.id === id ? { ...memory, content } : memory))
    )
  }

  const handleLoadMore = async () => {
    if (!hasMore || isLoadingMore || memories.length === 0) {
      return
    }

    const cursor = memories[memories.length - 1]
    if (!cursor) return

    setIsLoadingMore(true)
    try {
      const params = new URLSearchParams({
        limit: String(LOAD_MORE_PAGE_SIZE),
        beforeCreatedAt: cursor.created_at,
        beforeId: cursor.id,
      })
      const response = await fetch(`/api/memories?${params.toString()}`, {
        method: "GET",
      })
      if (!response.ok) {
        throw new Error(`Failed to load memories (HTTP ${response.status})`)
      }

      const payload = await response.json().catch(() => ({} as Record<string, unknown>))
      const incoming = Array.isArray(payload.memories)
        ? payload.memories
            .filter((item: unknown): item is Partial<Memory> & { id: string; content: string; created_at: string } =>
              typeof item === "object" &&
              item !== null &&
              "id" in item &&
              "content" in item &&
              "created_at" in item &&
              typeof item.id === "string" &&
              typeof item.content === "string" &&
              typeof item.created_at === "string"
            )
            .map((item: Partial<Memory> & { id: string; content: string; created_at: string }) => normalizeMemory(item))
        : []

      setMemories((previous) => {
        const knownIds = new Set(previous.map((memory) => memory.id))
        const merged = [...previous]
        for (const memory of incoming) {
          if (knownIds.has(memory.id)) continue
          knownIds.add(memory.id)
          merged.push(memory)
        }
        return merged
      })
      setHasMore(Boolean(payload.hasMore) && incoming.length > 0)
    } catch (error) {
      console.error("Failed to load more memories:", error)
    } finally {
      setIsLoadingMore(false)
    }
  }

  // Get unique types with counts
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    memories.forEach((m) => {
      const type = m.type || "memory"
      counts.set(type, (counts.get(type) || 0) + 1)
    })
    return counts
  }, [memories])

  // Get unique projects with counts (using project_id for project-scoped memories)
  const projectScopes = useMemo(() => {
    const scopeCounts = new Map<string, number>()
    memories.forEach((m) => {
      if (m.scope === "project" && m.project_id) {
        scopeCounts.set(m.project_id, (scopeCounts.get(m.project_id) || 0) + 1)
      }
    })
    return Array.from(scopeCounts.entries())
      .map(([scope, count]) => ({ scope, count }))
      .sort((a, b) => b.count - a.count)
  }, [memories])

  // Filter memories
  const filteredMemories = useMemo(() => {
    let result = memories

    // Type filter
    if (typeFilter !== "all") {
      result = result.filter((m) => (m.type || "memory") === typeFilter)
    }

    // Scope filter
    if (scopeFilter === "global") {
      result = result.filter((m) => m.scope === "global")
    } else if (scopeFilter !== "all") {
      // Filter by project_id for project-scoped memories
      result = result.filter((m) => m.project_id === scopeFilter)
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter((m) => 
        m.content.toLowerCase().includes(query) ||
        m.tags?.toLowerCase().includes(query)
      )
    }

    return result
  }, [memories, typeFilter, scopeFilter, searchQuery])

  const globalCount = memories.filter((m) => m.scope === "global").length
  const allProjectCount = memories.filter((m) => m.scope === "project" && m.project_id).length
  const isProjectFilter = scopeFilter !== "all" && scopeFilter !== "global"

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Your Memories</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Rules, commands, skills, and context that sync to your AI tools
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-2 py-1 border border-border">
          {memories.length} total
        </span>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search memories..."
          className="w-full pl-10 pr-4 py-2 bg-muted/30 border border-border text-sm focus:outline-none focus:border-primary/50"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Type Filter */}
        <div className="flex items-center gap-1 p-1 bg-muted/30 border border-border">
          {TYPE_OPTIONS.map((opt) => {
            const count = opt.value === "all" 
              ? memories.length 
              : typeCounts.get(opt.value) || 0
            
            if (opt.value !== "all" && count === 0) return null
            
            return (
              <button
                key={opt.value}
                onClick={() => setTypeFilter(opt.value)}
                className={`px-2 py-1 text-[10px] uppercase tracking-wider font-bold transition-colors ${
                  typeFilter === opt.value
                    ? `bg-background border border-border ${opt.color || "text-foreground"}`
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label} {count > 0 && `(${count})`}
              </button>
            )
          })}
        </div>

        {/* Scope Filter */}
        <div className="flex items-center gap-1 p-1 bg-muted/30 border border-border">
          <button
            onClick={() => setScopeFilter("all")}
            className={`px-2 py-1 text-[10px] uppercase tracking-wider font-bold transition-colors ${
              scopeFilter === "all"
                ? "bg-background text-foreground border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setScopeFilter("global")}
            className={`px-2 py-1 text-[10px] uppercase tracking-wider font-bold transition-colors ${
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
              className={`px-2 py-1 text-[10px] uppercase tracking-wider font-bold transition-colors flex items-center gap-1 ${
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
                      No project-scoped items
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Clear filters */}
        {(typeFilter !== "all" || scopeFilter !== "all" || searchQuery) && (
          <button
            onClick={() => {
              setTypeFilter("all")
              setScopeFilter("all")
              setSearchQuery("")
            }}
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Active filters display */}
      {(isProjectFilter || typeFilter !== "all") && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground">Active filters:</span>
          {typeFilter !== "all" && (
            <span className={`px-2 py-0.5 bg-primary/10 border border-primary/20 text-[10px] tracking-wider font-bold ${
              TYPE_OPTIONS.find(t => t.value === typeFilter)?.color || "text-primary"
            }`}>
              {TYPE_OPTIONS.find(t => t.value === typeFilter)?.label}
            </span>
          )}
          {isProjectFilter && (
            <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-[10px] tracking-wider font-bold text-amber-400">
              {formatProjectName(scopeFilter)}
            </span>
          )}
        </div>
      )}

      <div className="space-y-4">
        <AddRuleForm onAdd={handleAdd} />
        
        {filteredMemories.length === 0 ? (
          <div className="border border-border bg-card/20 p-8 text-center">
            <p className="text-muted-foreground text-sm">
              {memories.length === 0 
                ? "No memories yet. Add your first rule above."
                : "No memories match your filters."}
            </p>
          </div>
        ) : (
          <MemoriesList 
            memories={filteredMemories}
            onDeleteMemory={handleDeleteMemory}
            onUpdateMemory={handleUpdateMemory}
            onFilterByProject={(scope) => setScopeFilter(scope)}
          />
        )}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="px-4 py-2 text-[11px] uppercase tracking-[0.15em] font-bold border border-border bg-muted/30 hover:bg-muted/50 text-foreground disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isLoadingMore ? "Loading..." : "Load Older Memories"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
