import { nanoid } from "nanoid";
import { getDb } from "./db.js";
import { getProjectId } from "./git.js";
import { logger } from "./logger.js";

/**
 * Record a history entry for a memory change.
 * Used for version tracking.
 */
async function recordMemoryHistory(
  memory: Memory,
  changeType: "created" | "updated" | "deleted"
): Promise<void> {
  const db = await getDb();
  
  // Ensure history table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_history (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      type TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      change_type TEXT NOT NULL
    )
  `);
  
  const historyId = `${memory.id}-${Date.now()}`;
  await db.execute({
    sql: `INSERT INTO memory_history (id, memory_id, content, tags, type, change_type) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [historyId, memory.id, memory.content, memory.tags, memory.type, changeType],
  });
}

export type Scope = "global" | "project";

/**
 * Memory types:
 * - rule: Always-active rules/preferences (e.g., "Always use TypeScript strict mode")
 * - decision: Why we chose something (e.g., "Chose PostgreSQL over MySQL because...")
 * - fact: Project-specific knowledge (e.g., "API rate limit is 100/min")
 * - note: General memories (default, backwards compatible)
 */
export type MemoryType = "rule" | "decision" | "fact" | "note" | "skill";

export const MEMORY_TYPES: readonly MemoryType[] = ["rule", "decision", "fact", "note", "skill"] as const;

export function isMemoryType(value: string): value is MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(value);
}

export interface Memory {
  id: string;
  content: string;
  tags: string | null;
  scope: Scope;
  project_id: string | null;
  type: MemoryType;
  paths: string | null;
  category: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AddMemoryOpts {
  tags?: string[];
  global?: boolean;
  projectId?: string; // Override auto-detected project
  type?: MemoryType; // Memory type (default: 'note')
  paths?: string[]; // Glob patterns for path-scoped rules
  category?: string; // Free-form grouping key
  metadata?: Record<string, unknown>; // Extended attributes (stored as JSON)
}

interface QueryMemoryOpts {
  limit?: number;
  tags?: string[];
  projectId?: string; // Override auto-detected project
  includeGlobal?: boolean; // Default true - include global memories
  globalOnly?: boolean; // Only return global memories (skips project auto-detect)
  types?: MemoryType[]; // Filter by memory types
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
  const type = opts?.type ?? "note";
  const paths = opts?.paths?.length ? opts.paths.join(",") : null;
  const category = opts?.category ?? null;
  const metadata = opts?.metadata ? JSON.stringify(opts.metadata) : null;

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
    sql: `INSERT INTO memories (id, content, tags, scope, project_id, type, paths, category, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, content, tags, scope, projectId, type, paths, category, metadata],
  });

  // Generate embedding in background (don't block on it)
  generateEmbeddingAsync(id, content);

  const result = await db.execute({
    sql: `SELECT * FROM memories WHERE id = ?`,
    args: [id],
  });

  return result.rows[0] as unknown as Memory;
}

/**
 * Generate embedding for a memory asynchronously.
 * Failures are logged but don't block the operation.
 */
async function generateEmbeddingAsync(memoryId: string, content: string): Promise<void> {
  try {
    const { getEmbedding, storeEmbedding, ensureEmbeddingsSchema, EmbeddingError } = await import("./embeddings.js");
    await ensureEmbeddingsSchema();
    const embedding = await getEmbedding(content);
    await storeEmbedding(memoryId, embedding);
  } catch (error) {
    // Log embedding failures - they're optional but we want visibility
    const message = error instanceof Error ? error.message : "Unknown error";
    const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
    logger.warn(`Failed to embed memory ${memoryId}: ${message}`, cause ?? "");
  }
}

/**
 * Get a single memory by ID.
 */
export async function getMemoryById(id: string): Promise<Memory | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });
  return result.rows.length > 0 ? (result.rows[0] as unknown as Memory) : null;
}

/**
 * Search memories by content using full-text search.
 * Returns both global and project memories (if in a git repo).
 * Results are ranked by relevance.
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

  // Build scope filter
  const scopeConditions: string[] = [];
  const args: (string | number)[] = [];

  if (includeGlobal) {
    scopeConditions.push("m.scope = 'global'");
  }
  if (projectId) {
    scopeConditions.push("(m.scope = 'project' AND m.project_id = ?)");
    args.push(projectId);
  }

  // If no scope conditions, return empty (not all memories)
  if (scopeConditions.length === 0) {
    return [];
  }

  // Type filter
  let typeFilter = "";
  if (opts?.types?.length) {
    const placeholders = opts.types.map(() => "?").join(", ");
    typeFilter = `AND m.type IN (${placeholders})`;
    args.push(...opts.types);
  }

  // Use FTS5 for better search with ranking
  // The bm25() function returns relevance scores (lower is better)
  const ftsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map(term => `"${term}"*`) // Prefix matching for each term
    .join(" OR ");

  args.push(limit);

  try {
    const result = await db.execute({
      sql: `
        SELECT m.*, bm25(memories_fts) as rank
        FROM memories m
        JOIN memories_fts fts ON m.rowid = fts.rowid
        WHERE memories_fts MATCH ?
          AND m.deleted_at IS NULL
          AND (${scopeConditions.join(" OR ")})
          ${typeFilter}
        ORDER BY rank ASC, m.created_at DESC
        LIMIT ?
      `,
      args: [ftsQuery, ...args],
    });

    return result.rows as unknown as Memory[];
  } catch (error) {
    // Fallback to LIKE search if FTS fails (e.g., empty index)
    logger.warn("FTS search failed, falling back to LIKE:", error);
    return searchMemoriesLike(query, opts);
  }
}

/**
 * Fallback search using LIKE (less accurate but always works)
 */
async function searchMemoriesLike(
  query: string,
  opts?: QueryMemoryOpts
): Promise<Memory[]> {
  const db = await getDb();
  const limit = opts?.limit ?? 20;
  const includeGlobal = opts?.includeGlobal ?? true;
  const projectId = opts?.globalOnly ? undefined : (opts?.projectId ?? getProjectId());

  const conditions: string[] = ["deleted_at IS NULL", "content LIKE ?"];
  const args: (string | number)[] = [`%${query}%`];

  const scopeConditions: string[] = [];
  if (includeGlobal) {
    scopeConditions.push("scope = 'global'");
  }
  if (projectId) {
    scopeConditions.push("(scope = 'project' AND project_id = ?)");
    args.push(projectId);
  }

  if (scopeConditions.length === 0) {
    return [];
  }

  conditions.push(`(${scopeConditions.join(" OR ")})`);

  if (opts?.types?.length) {
    const placeholders = opts.types.map(() => "?").join(", ");
    conditions.push(`type IN (${placeholders})`);
    args.push(...opts.types);
  }

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

  // Type filter
  if (opts?.types?.length) {
    const placeholders = opts.types.map(() => "?").join(", ");
    conditions.push(`type IN (${placeholders})`);
    args.push(...opts.types);
  }

  args.push(limit);

  const result = await db.execute({
    sql: `SELECT * FROM memories WHERE ${conditions.join(" AND ")} ORDER BY type ASC, scope ASC, created_at DESC LIMIT ?`,
    args,
  });

  return result.rows as unknown as Memory[];
}

/**
 * Get all active rules for the current context.
 * Rules are always returned first, sorted by scope (global first, then project).
 */
export async function getRules(opts?: { projectId?: string }): Promise<Memory[]> {
  const db = await getDb();
  const projectId = opts?.projectId ?? getProjectId();

  const conditions: string[] = ["deleted_at IS NULL", "type = 'rule'"];
  const args: (string | number)[] = [];

  const scopeConditions: string[] = ["scope = 'global'"];
  if (projectId) {
    scopeConditions.push("(scope = 'project' AND project_id = ?)");
    args.push(projectId);
  }

  conditions.push(`(${scopeConditions.join(" OR ")})`);

  const result = await db.execute({
    sql: `SELECT * FROM memories WHERE ${conditions.join(" AND ")} ORDER BY scope ASC, created_at ASC`,
    args,
  });

  return result.rows as unknown as Memory[];
}

/**
 * Get context for an AI agent - rules first, then relevant memories.
 * This is the primary function for MCP context retrieval.
 */
export async function getContext(
  query?: string,
  opts?: { projectId?: string; limit?: number }
): Promise<{ rules: Memory[]; memories: Memory[] }> {
  const projectId = opts?.projectId ?? getProjectId();
  const limit = opts?.limit ?? 10;

  // Always get all rules
  const rules = await getRules({ projectId: projectId ?? undefined });

  // If there's a query, search for relevant memories (excluding rules)
  let memories: Memory[] = [];
  if (query) {
    memories = await searchMemories(query, {
      projectId: projectId ?? undefined,
      limit,
      types: ["decision", "fact", "note"], // Exclude rules, they're already included
    });
  }

  return { rules, memories };
}

/**
 * Update a memory's content or metadata.
 * Records history before making changes.
 */
export async function updateMemory(
  id: string,
  updates: {
    content?: string;
    tags?: string[];
    type?: MemoryType;
    paths?: string[];
    category?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  options?: { skipHistory?: boolean }
): Promise<Memory | null> {
  const db = await getDb();

  // Check if memory exists and is not deleted
  const existing = await db.execute({
    sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  });

  if (existing.rows.length === 0) return null;

  // Record history before update (unless skipped)
  if (!options?.skipHistory) {
    const old = existing.rows[0] as unknown as Memory;
    await recordMemoryHistory(old, "updated");
  }

  const setClauses: string[] = ["updated_at = datetime('now')"];
  const args: (string | null)[] = [];

  if (updates.content !== undefined) {
    setClauses.push("content = ?");
    args.push(updates.content);
  }

  if (updates.tags !== undefined) {
    setClauses.push("tags = ?");
    args.push(updates.tags.length ? updates.tags.join(",") : null);
  }

  if (updates.type !== undefined) {
    setClauses.push("type = ?");
    args.push(updates.type);
  }

  if (updates.paths !== undefined) {
    setClauses.push("paths = ?");
    args.push(updates.paths.length ? updates.paths.join(",") : null);
  }

  if (updates.category !== undefined) {
    setClauses.push("category = ?");
    args.push(updates.category);
  }

  if (updates.metadata !== undefined) {
    setClauses.push("metadata = ?");
    args.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
  }

  args.push(id);

  await db.execute({
    sql: `UPDATE memories SET ${setClauses.join(", ")} WHERE id = ?`,
    args,
  });

  const result = await db.execute({
    sql: `SELECT * FROM memories WHERE id = ?`,
    args: [id],
  });

  return result.rows[0] as unknown as Memory;
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

// Re-export streaming API
export {
  startMemoryStream,
  appendMemoryChunk,
  finalizeMemoryStream,
  cancelMemoryStream,
  getStreamState,
  listActiveStreams,
} from "./memory-stream.js";

// Re-export bulk operations
export {
  type BulkForgetFilter,
  findMemoriesToForget,
  bulkForgetByIds,
  vacuumMemories,
} from "./memory-bulk.js";
