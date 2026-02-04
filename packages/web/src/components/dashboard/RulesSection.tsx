"use client"

import { useState } from "react"
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

export function RulesSection({ initialRules }: { initialRules: Memory[] }) {
  const [rules, setRules] = useState(initialRules)

  const handleAdd = (memory: Memory) => {
    setRules((prev) => [memory, ...prev])
  }

  const handleChange = (updated: Memory[]) => {
    setRules(updated)
  }

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

      <div className="space-y-4">
        <AddRuleForm onAdd={handleAdd} />
        
        {rules.length === 0 ? (
          <div className="border border-border bg-card/20 p-8 text-center">
            <p className="text-muted-foreground text-sm">
              No rules yet. Click &quot;Add Rule&quot; above to create your first rule.
            </p>
          </div>
        ) : (
          <MemoriesList initialMemories={rules} onMemoriesChange={handleChange} />
        )}
      </div>
    </div>
  )
}
