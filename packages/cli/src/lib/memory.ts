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

// ─── Streaming Memory API ────────────────────────────────────────────────────
// For collecting content from SSE streams (v0, etc.) and embedding on completion

/**
 * In-memory store for active streams.
 * Streams are short-lived so we don't need persistence.
 * Map<streamId, StreamState>
 */
interface StreamState {
  id: string;
  chunks: string[];
  opts: AddMemoryOpts;
  createdAt: Date;
  lastChunkAt: Date;
}

const activeStreams = new Map<string, StreamState>();

// Clean up stale streams older than 1 hour
const STREAM_TTL_MS = 60 * 60 * 1000;

function cleanupStaleStreams(): void {
  const now = Date.now();
  for (const [id, stream] of activeStreams) {
    if (now - stream.lastChunkAt.getTime() > STREAM_TTL_MS) {
      activeStreams.delete(id);
      logger.info(`Cleaned up stale stream ${id} (no chunks for 1 hour)`);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupStaleStreams, 5 * 60 * 1000).unref();

/**
 * Start a new memory stream for collecting SSE chunks.
 * Returns a stream ID to use for appending chunks and finalizing.
 */
export function startMemoryStream(opts?: AddMemoryOpts): string {
  const id = nanoid(12);
  const now = new Date();
  
  activeStreams.set(id, {
    id,
    chunks: [],
    opts: opts ?? {},
    createdAt: now,
    lastChunkAt: now,
  });
  
  return id;
}

/**
 * Append a chunk of content to an active stream.
 * Throws if stream doesn't exist.
 */
export function appendMemoryChunk(streamId: string, chunk: string): void {
  const stream = activeStreams.get(streamId);
  if (!stream) {
    throw new Error(`Stream ${streamId} not found or expired`);
  }
  
  stream.chunks.push(chunk);
  stream.lastChunkAt = new Date();
}

/**
 * Get current state of a stream (for debugging/monitoring).
 */
export function getStreamState(streamId: string): { 
  exists: boolean; 
  chunkCount: number; 
  contentLength: number;
  ageMs: number;
} | null {
  const stream = activeStreams.get(streamId);
  if (!stream) return null;
  
  const content = stream.chunks.join("");
  return {
    exists: true,
    chunkCount: stream.chunks.length,
    contentLength: content.length,
    ageMs: Date.now() - stream.createdAt.getTime(),
  };
}

/**
 * Finalize a stream: join chunks, create memory, trigger embedding.
 * Returns the created memory or null if stream was empty.
 * Cleans up the stream state after completion.
 */
export async function finalizeMemoryStream(streamId: string): Promise<Memory | null> {
  const stream = activeStreams.get(streamId);
  if (!stream) {
    throw new Error(`Stream ${streamId} not found or expired`);
  }
  
  // Clean up immediately
  activeStreams.delete(streamId);
  
  // Join all chunks
  const content = stream.chunks.join("");
  
  // Skip empty streams
  if (!content.trim()) {
    return null;
  }
  
  // Create the memory (this triggers embedding automatically)
  return addMemory(content, stream.opts);
}

/**
 * Cancel an active stream without creating a memory.
 */
export function cancelMemoryStream(streamId: string): boolean {
  return activeStreams.delete(streamId);
}

/**
 * List all active streams (for debugging).
 */
export function listActiveStreams(): Array<{
  id: string;
  chunkCount: number;
  contentLength: number;
  ageMs: number;
}> {
  const result: Array<{
    id: string;
    chunkCount: number;
    contentLength: number;
    ageMs: number;
  }> = [];
  
  for (const stream of activeStreams.values()) {
    const content = stream.chunks.join("");
    result.push({
      id: stream.id,
      chunkCount: stream.chunks.length,
      contentLength: content.length,
      ageMs: Date.now() - stream.createdAt.getTime(),
    });
  }
  
  return result;
}

export interface BulkForgetFilter {
  types?: MemoryType[];
  tags?: string[];
  olderThanDays?: number;
  pattern?: string;
  all?: boolean;
  projectId?: string;
}

/**
 * Find memories matching a bulk filter (for preview/dry-run).
 * Filters are always applied, even with `all: true` (which just means no filter is required).
 */
export async function findMemoriesToForget(filter: BulkForgetFilter): Promise<Memory[]> {
  const db = await getDb();

  const conditions: string[] = ["deleted_at IS NULL"];
  const args: (string | number)[] = [];

  if (filter.types?.length) {
    const placeholders = filter.types.map(() => "?").join(", ");
    conditions.push(`type IN (${placeholders})`);
    args.push(...filter.types);
  }

  if (filter.tags?.length) {
    const tagClauses = filter.tags.map(() => `tags LIKE ?`).join(" OR ");
    conditions.push(`(${tagClauses})`);
    args.push(...filter.tags.map((t) => `%${t}%`));
  }

  if (filter.olderThanDays !== undefined) {
    conditions.push(`created_at < datetime('now', ?)`);
    args.push(`-${filter.olderThanDays} days`);
  }

  if (filter.pattern) {
    // Escape literal LIKE wildcards, then convert glob syntax (* → %, ? → _)
    const likePattern = filter.pattern
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
      .replace(/\*/g, "%")
      .replace(/\?/g, "_");
    conditions.push(`content LIKE ? ESCAPE '\\'`);
    args.push(`%${likePattern}%`);
  }

  // Scope to project if specified
  if (filter.projectId) {
    conditions.push("(scope = 'project' AND project_id = ?)");
    args.push(filter.projectId);
  }

  const result = await db.execute({
    sql: `SELECT * FROM memories WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    args,
  });

  return result.rows as unknown as Memory[];
}

/**
 * Bulk soft-delete memories by their IDs.
 * Accepts pre-fetched IDs to avoid TOCTOU issues with the preview.
 * Batches in chunks of 500 to stay within SQLite variable limits.
 */
export async function bulkForgetByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const db = await getDb();
  const batchSize = 500;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const placeholders = batch.map(() => "?").join(", ");
    await db.execute({
      sql: `UPDATE memories SET deleted_at = datetime('now') WHERE id IN (${placeholders})`,
      args: batch,
    });
  }

  return ids.length;
}

/**
 * Permanently delete all soft-deleted memories (vacuum).
 * Returns the count of purged rows.
 */
export async function vacuumMemories(): Promise<number> {
  const db = await getDb();

  const [, changesResult] = await db.batch([
    { sql: `DELETE FROM memories WHERE deleted_at IS NOT NULL`, args: [] },
    { sql: `SELECT changes() as cnt`, args: [] },
  ]);

  return Number((changesResult.rows[0] as unknown as { cnt: number }).cnt) || 0;
}
