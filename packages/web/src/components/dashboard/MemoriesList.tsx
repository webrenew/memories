"use client"

import React from "react"
import { MemoryCard } from "./MemoryCard"
import type { Memory } from "@/types/memory"

export function MemoriesList({
  memories,
  onDeleteMemory,
  onUpdateMemory,
  onFilterByProject
}: {
  memories: Memory[]
  onDeleteMemory?: (id: string) => void
  onUpdateMemory?: (id: string, content: string) => void
  onFilterByProject?: (scope: string) => void
}): React.JSX.Element | null {
  const handleDelete = (id: string) => {
    onDeleteMemory?.(id)
  }

  const handleUpdate = (id: string, content: string) => {
    onUpdateMemory?.(id, content)
  }

  if (memories.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {memories.map((memory) => (
        <MemoryCard 
          key={memory.id} 
          memory={memory} 
          onDelete={handleDelete}
          onUpdate={handleUpdate}
          onFilterByProject={onFilterByProject}
        />
      ))}
    </div>
  )
}
