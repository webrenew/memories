"use client"

import { useState } from "react"
import { MemoryCard } from "./MemoryCard"

interface Memory {
  id: string
  content: string
  tags: string | null
  type: string | null
  scope: string | null
  project_id: string | null
  created_at: string
}

export function MemoriesList({ 
  initialMemories,
  onMemoriesChange,
  onFilterByProject
}: { 
  initialMemories: Memory[]
  onMemoriesChange?: (memories: Memory[]) => void
  onFilterByProject?: (scope: string) => void
}) {
  const [memories, setMemories] = useState(initialMemories)

  const handleDelete = (id: string) => {
    const updated = memories.filter((m) => m.id !== id)
    setMemories(updated)
    onMemoriesChange?.(updated)
  }

  const handleUpdate = (id: string, content: string) => {
    const updated = memories.map((m) => 
      m.id === id ? { ...m, content } : m
    )
    setMemories(updated)
    onMemoriesChange?.(updated)
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
