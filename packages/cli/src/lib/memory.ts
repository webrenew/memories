import { nanoid } from "nanoid";
import { getDb } from "./db.js";
import { getProjectId } from "./git.js";

export type Scope = "global" | "project";

export interface Memory {
  id: string;
  content: string;
  tags: string | null;
  scope: Scope;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AddMemoryOpts {
  tags?: string[];
  global?: boolean;
  projectId?: string; // Override auto-detected project
}

export interface QueryMemoryOpts {
  limit?: number;
  tags?: string[];
  projectId?: string; // Override auto-detected project
  includeGlobal?: boolean; // Default true - include global memories
  globalOnly?: boolean; // Only return global memories (skips project auto-detect)
}

/**
 * Add a new memory.
 * By default, scopes to current git project. Use global: true for global scope.
 */
export async function addMemory(
  content: string,
  opts?: AddMemoryOpts
): Promise<Memory> {
  const db = await getDb();
  const id = nanoid(12);
  const tags = opts?.tags?.length ? opts.tags.join(",") : null;

  let scope: Scope = "global";
  let projectId: string | null = null;

  if (!opts?.global) {
    // Default to project scope if in a git repo
    projectId = opts?.projectId ?? getProjectId();
    if (projectId) {
      scope = "project";
    }
  }

  await db.execute({
    sql: `INSERT INTO memories (id, content, tags, scope, project_id) VALUES (?, ?, ?, ?, ?)`,
    args: [id, content, tags, scope, projectId],
  });

  const result = await db.execute({
    sql: `SELECT * FROM memories WHERE id = ?`,
    args: [id],
  });

  return result.rows[0] as unknown as Memory;
}

/**
 * Search memories by content.
 * Returns both global and project memories (if in a git repo).
 */
export async function searchMemories(
  query: string,
  opts?: QueryMemoryOpts
): Promise<Memory[]> {
  const db = await getDb();
  const limit = opts?.limit ?? 20;
  const includeGlobal = opts?.includeGlobal ?? true;
  // Skip auto-detect if globalOnly is set
  const projectId = opts?.globalOnly ? undefined : (opts?.projectId ?? getProjectId());

  const conditions: string[] = ["deleted_at IS NULL", "content LIKE ?"];
  const args: (string | number)[] = [`%${query}%`];

  // Build scope filter
  const scopeConditions: string[] = [];
  if (includeGlobal) {
    scopeConditions.push("scope = 'global'");
  }
  if (projectId) {
    scopeConditions.push("(scope = 'project' AND project_id = ?)");
    args.push(projectId);
  }

  // If no scope conditions, return empty (not all memories)
  if (scopeConditions.length === 0) {
    return [];
  }

  conditions.push(`(${scopeConditions.join(" OR ")})`);
  args.push(limit);

  const result = await db.execute({
    sql: `SELECT * FROM memories WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    args,
  });

  return result.rows as unknown as Memory[];
}

/**
 * List memories.
 * Returns both global and project memories (if in a git repo).
 */
export async function listMemories(opts?: QueryMemoryOpts): Promise<Memory[]> {
  const db = await getDb();
  const limit = opts?.limit ?? 50;
  const includeGlobal = opts?.includeGlobal ?? true;
  // Skip auto-detect if globalOnly is set
  const projectId = opts?.globalOnly ? undefined : (opts?.projectId ?? getProjectId());

  const conditions: string[] = ["deleted_at IS NULL"];
  const args: (string | number)[] = [];

  // Build scope filter
  const scopeConditions: string[] = [];
  if (includeGlobal) {
    scopeConditions.push("scope = 'global'");
  }
  if (projectId) {
    scopeConditions.push("(scope = 'project' AND project_id = ?)");
    args.push(projectId);
  }

  // If no scope conditions, return empty (not all memories)
  if (scopeConditions.length === 0) {
    return [];
  }

  conditions.push(`(${scopeConditions.join(" OR ")})`);

  // Tag filter
  if (opts?.tags?.length) {
    const tagClauses = opts.tags.map(() => `tags LIKE ?`).join(" OR ");
    conditions.push(`(${tagClauses})`);
    args.push(...opts.tags.map((t) => `%${t}%`));
  }

  args.push(limit);

  const result = await db.execute({
    sql: `SELECT * FROM memories WHERE ${conditions.join(" AND ")} ORDER BY scope ASC, created_at DESC LIMIT ?`,
    args,
  });

  return result.rows as unknown as Memory[];
}

/**
 * Soft-delete a memory by ID.
 */
export async function forgetMemory(id: string): Promise<boolean> {
  const db = await getDb();

  // Check if memory exists and is not already deleted
  const existing = await db.execute({
    sql: `SELECT id FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });

  if (existing.rows.length === 0) return false;

  await db.execute({
    sql: `UPDATE memories SET deleted_at = datetime('now') WHERE id = ?`,
    args: [id],
  });

  return true;
}
