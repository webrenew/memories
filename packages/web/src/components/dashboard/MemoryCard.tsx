"use client"

import React, { useState } from "react"
import { Trash2, Pencil, Check, X } from "lucide-react"
import type { Memory } from "@/types/memory"

export function MemoryCard({
  memory,
  onDelete,
  onUpdate,
  onFilterByProject
}: {
  memory: Memory
  onDelete: (id: string) => void
  onUpdate: (id: string, content: string) => void
  onFilterByProject?: (scope: string) => void
}): React.JSX.Element {
  const [isDeleting, setIsDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(memory.content)
  const [isSaving, setIsSaving] = useState(false)

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch("/api/memories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: memory.id }),
      })
      if (res.ok) {
        onDelete(memory.id)
      }
    } finally {
      setIsDeleting(false)
      setShowConfirm(false)
    }
  }

  const handleSave = async () => {
    if (!editContent.trim() || editContent === memory.content) {
      setIsEditing(false)
      setEditContent(memory.content)
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch("/api/memories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: memory.id, content: editContent.trim() }),
      })
      if (res.ok) {
        onUpdate(memory.id, editContent.trim())
        setIsEditing(false)
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      id={`memory-${memory.id}`}
      className="group border border-border bg-card/20 p-5 hover:border-primary/30 transition-all duration-300"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          {memory.type ? (
            <span className={`px-2 py-0.5 border text-[10px] uppercase tracking-wider font-bold ${
              memory.type === "rule"
                ? "bg-primary/10 border-primary/20 text-primary"
                : memory.type === "skill"
                ? "bg-purple-500/10 border-purple-500/20 text-purple-400"
                : memory.type === "decision"
                ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                : memory.type === "fact"
                ? "bg-pink-500/10 border-pink-500/20 text-pink-400"
                : "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
            }`}>
              {memory.type}
            </span>
          ) : null}
          {memory.scope === "global" ? (
            <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 text-[10px] uppercase tracking-wider font-bold text-blue-400">
              Global
            </span>
          ) : memory.scope === "project" && memory.project_id ? (
            <button
              onClick={() => onFilterByProject?.(memory.project_id!)}
              className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-[10px] tracking-wider font-bold text-amber-400 hover:bg-amber-500/20 transition-colors" 
              title={`Filter by ${memory.project_id}`}
            >
              {memory.project_id.replace(/^github\.com\//, "")}
            </button>
          ) : null}
          {memory.tags
            ? memory.tags.split(",").map((tag: string) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 bg-muted/50 border border-border text-[10px] uppercase tracking-wider font-bold text-muted-foreground"
                >
                  {tag.trim()}
                </span>
              ))
            : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground/60 shrink-0">
            {new Date(memory.created_at).toLocaleDateString()}
          </span>
          {isEditing ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="p-1.5 text-green-400 hover:bg-green-500/10 transition-all"
                title="Save"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setIsEditing(false)
                  setEditContent(memory.content)
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground transition-all"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : showConfirm ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                {isDeleting ? "..." : "Delete"}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold bg-muted/50 text-muted-foreground border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
              <button
                onClick={() => setIsEditing(true)}
                className="p-1.5 text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-all"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowConfirm(true)}
                className="p-1.5 text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10 transition-all"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
      {isEditing ? (
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="w-full bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary/50 resize-none"
          rows={3}
          autoFocus
        />
      ) : (
        <p className="text-sm text-foreground/80 leading-relaxed">
          {memory.content}
        </p>
      )}
    </div>
  )
}
