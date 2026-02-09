/**
 * Canonical memory types — single source of truth for web package.
 * Matches the CLI definition in packages/cli/src/lib/memory.ts.
 */

export type MemoryType = "rule" | "decision" | "fact" | "note" | "skill"

export type Scope = "global" | "project"

export interface Memory {
  id: string
  content: string
  tags: string | null
  scope: Scope
  project_id: string | null
  type: MemoryType
  paths: string | null
  category: string | null
  metadata: string | null
  created_at: string
  updated_at: string
}
