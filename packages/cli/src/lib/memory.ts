import { nanoid } from "nanoid";
import { getDb } from "./db.js";
import { getProjectId } from "./git.js";
import { logger } from "./logger.js";
import {
  appendOpenClawDailyLog,
  formatOpenClawBootstrapContext,
  isOpenClawFileModeEnabled,
  readOpenClawBootstrapContext,
  writeOpenClawSnapshot,
} from "./openclaw-memory.js";

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

export type MemoryLayer = "rule" | "working" | "long_term";

export const MEMORY_LAYERS: readonly MemoryLayer[] = ["rule", "working", "long_term"] as const;

export function isMemoryLayer(value: string): value is MemoryLayer {
  return (MEMORY_LAYERS as readonly string[]).includes(value);
}

export type ContextMode = "all" | "working" | "long_term" | "rules_only";

export const CONTEXT_MODES: readonly ContextMode[] = ["all", "working", "long_term", "rules_only"] as const;

export function isContextMode(value: string): value is ContextMode {
  return (CONTEXT_MODES as readonly string[]).includes(value);
}

export type MemorySessionStatus = "active" | "compacted" | "closed";
export const MEMORY_SESSION_STATUSES: readonly MemorySessionStatus[] = ["active", "compacted", "closed"] as const;

export function isMemorySessionStatus(value: string): value is MemorySessionStatus {
  return (MEMORY_SESSION_STATUSES as readonly string[]).includes(value);
}

export type MemorySessionRole = "user" | "assistant" | "tool";
export const MEMORY_SESSION_ROLES: readonly MemorySessionRole[] = ["user", "assistant", "tool"] as const;

export function isMemorySessionRole(value: string): value is MemorySessionRole {
  return (MEMORY_SESSION_ROLES as readonly string[]).includes(value);
}

export type MemorySessionEventKind = "message" | "checkpoint" | "summary" | "event";
export const MEMORY_SESSION_EVENT_KINDS: readonly MemorySessionEventKind[] = ["message", "checkpoint", "summary", "event"] as const;

export function isMemorySessionEventKind(value: string): value is MemorySessionEventKind {
  return (MEMORY_SESSION_EVENT_KINDS as readonly string[]).includes(value);
}

export type MemorySessionSnapshotTrigger = "new_session" | "reset" | "manual" | "auto_compaction";
export const MEMORY_SESSION_SNAPSHOT_TRIGGERS: readonly MemorySessionSnapshotTrigger[] = ["new_session", "reset", "manual", "auto_compaction"] as const;

export function isMemorySessionSnapshotTrigger(value: string): value is MemorySessionSnapshotTrigger {
  return (MEMORY_SESSION_SNAPSHOT_TRIGGERS as readonly string[]).includes(value);
}

export type CompactionTriggerType = "count" | "time" | "semantic";
export const COMPACTION_TRIGGER_TYPES: readonly CompactionTriggerType[] = ["count", "time", "semantic"] as const;

export function isCompactionTriggerType(value: string): value is CompactionTriggerType {
  return (COMPACTION_TRIGGER_TYPES as readonly string[]).includes(value);
}

export interface Memory {
  id: string;
  content: string;
  tags: string | null;
  scope: Scope;
  project_id: string | null;
  user_id?: string | null;
  type: MemoryType;
  memory_layer: MemoryLayer | null;
  expires_at: string | null;
  upsert_key?: string | null;
  source_session_id?: string | null;
  superseded_by?: string | null;
  superseded_at?: string | null;
  confidence?: number | null;
  last_confirmed_at?: string | null;
  paths: string | null;
  category: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MemorySession {
  id: string;
  scope: Scope;
  project_id: string | null;
  user_id: string | null;
  client: string | null;
  status: MemorySessionStatus;
  title: string | null;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
  metadata: string | null;
}

export interface MemorySessionEvent {
  id: string;
  session_id: string;
  role: MemorySessionRole;
  kind: MemorySessionEventKind;
  content: string;
  token_count: number | null;
  turn_index: number | null;
  is_meaningful: number;
  created_at: string;
}

export interface MemorySessionSnapshot {
  id: string;
  session_id: string;
  slug: string;
  source_trigger: MemorySessionSnapshotTrigger;
  transcript_md: string;
  message_count: number;
  created_at: string;
}

export interface MemoryCompactionEvent {
  id: string;
  session_id: string;
  trigger_type: CompactionTriggerType;
  reason: string;
  token_count_before: number | null;
  turn_count_before: number | null;
  summary_tokens: number | null;
  checkpoint_memory_id: string | null;
  created_at: string;
}

export interface MemorySessionStatusSummary {
  session: MemorySession;
  eventCount: number;
  checkpointCount: number;
  snapshotCount: number;
  latestEventAt: string | null;
  latestCheckpointId: string | null;
  latestCheckpointAt: string | null;
  latestSnapshotAt: string | null;
}

export interface AddMemoryOpts {
  tags?: string[];
  global?: boolean;
  projectId?: string; // Override auto-detected project
  type?: MemoryType; // Memory type (default: 'note')
  layer?: MemoryLayer; // Memory layer (default: type-aware mapping)
  upsertKey?: string; // Deterministic key for overwrite-style updates
  sourceSessionId?: string; // Session provenance for extraction/consolidation
  confidence?: number; // Confidence score (0..1)
  lastConfirmedAt?: string; // ISO timestamp for freshness tracking
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
  layers?: MemoryLayer[]; // Filter by memory layers
}

export interface StartMemorySessionOpts {
  global?: boolean;
  projectId?: string;
  userId?: string;
  client?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionCheckpointOpts {
  role?: MemorySessionRole;
  kind?: MemorySessionEventKind;
  tokenCount?: number;
  turnIndex?: number;
  isMeaningful?: boolean;
}

export interface SessionEventListOpts {
  limit?: number;
  meaningfulOnly?: boolean;
}

export interface CreateSessionSnapshotOpts {
  slug?: string;
  sourceTrigger?: MemorySessionSnapshotTrigger;
  transcriptMd: string;
  messageCount: number;
}

export interface EndMemorySessionOpts {
  status?: Exclude<MemorySessionStatus, "active">;
}

export interface WriteAheadCompactionOpts {
  query?: string;
  rules: Memory[];
  memories: Memory[];
  triggerType?: CompactionTriggerType;
  reason?: string;
  tokenCountBefore?: number;
  turnCountBefore?: number;
  checkpointContent?: string;
}

export interface InactivityCompactionWorkerResult {
  inactivityMinutes: number;
  scanned: number;
  checkpointed: number;
  compacted: number;
  failures: Array<{ sessionId: string; error: string }>;
}

export interface MemoryConsolidationRun {
  id: string;
  scope: Scope;
  project_id: string | null;
  user_id: string | null;
  input_count: number;
  merged_count: number;
  superseded_count: number;
  conflicted_count: number;
  model: string | null;
  created_at: string;
  metadata: string | null;
}

export interface ConsolidateMemoriesOpts {
  projectId?: string;
  includeGlobal?: boolean;
  globalOnly?: boolean;
  types?: MemoryType[];
  dryRun?: boolean;
  model?: string;
}

export interface ConsolidateMemoriesResult {
  run: MemoryConsolidationRun;
  supersededMemoryIds: string[];
  winnerMemoryIds: string[];
}

const DEFAULT_WORKING_MEMORY_TTL_HOURS = 24;
const WORKING_MEMORY_TTL_ENV_KEYS = ["MEMORIES_WORKING_MEMORY_TTL_HOURS", "MCP_WORKING_MEMORY_TTL_HOURS"] as const;

function normalizeContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    throw new Error("Memory content cannot be empty");
  }
  return normalized;
}

function normalizeStringList(values?: string[]): string[] | undefined {
  if (!values) return undefined;

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function resolvePositiveLimit(limit: number | undefined, fallback: number): number {
  if (!Number.isFinite(limit)) {
    return fallback;
  }

  const parsed = Math.trunc(limit as number);
  return parsed > 0 ? parsed : fallback;
}

function normalizeLayerList(values?: MemoryLayer[]): MemoryLayer[] | undefined {
  if (!values) return undefined;

  const seen = new Set<MemoryLayer>();
  const normalized: MemoryLayer[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function resolveWorkingMemoryTtlHours(): number {
  for (const key of WORKING_MEMORY_TTL_ENV_KEYS) {
    const raw = process.env[key];
    if (!raw) continue;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_WORKING_MEMORY_TTL_HOURS;
}

function workingMemoryExpiresAt(nowIso: string): string {
  return addHours(nowIso, resolveWorkingMemoryTtlHours());
}

function coerceCount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeSessionSlug(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (normalized) {
    return normalized;
  }

  return `snapshot-${Date.now()}`;
}

function estimateTokensFromText(input: string): number {
  const text = input.trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function truncateForSummary(input: string, max = 140): string {
  const trimmed = input.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trim()}...`;
}

function normalizeUpsertKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || null;
}

function deriveUpsertKey(memory: Pick<Memory, "type" | "content" | "category">): string | null {
  const fromCategory = normalizeUpsertKey(memory.category ?? undefined);
  if (fromCategory) {
    return `${memory.type}:${fromCategory}`;
  }

  const sourceLine = memory.content
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  if (!sourceLine) return null;

  const prefix = sourceLine.includes(":")
    ? sourceLine.split(":")[0]
    : sourceLine.split(/\s+/).slice(0, 6).join(" ");

  const normalizedPrefix = normalizeUpsertKey(prefix);
  if (!normalizedPrefix) return null;
  return `${memory.type}:${normalizedPrefix}`;
}

function normalizeConfidence(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  const bounded = Math.max(0, Math.min(1, Number(value)));
  return Number.isFinite(bounded) ? bounded : 1;
}

function defaultLayerForType(type: MemoryType): MemoryLayer {
  return type === "rule" ? "rule" : "long_term";
}

function buildActiveMemoryFilter(columnPrefix = ""): { clause: string; args: string[] } {
  return {
    clause: `${columnPrefix}deleted_at IS NULL AND (${columnPrefix}expires_at IS NULL OR ${columnPrefix}expires_at > ?)`,
    args: [new Date().toISOString()],
  };
}

function buildLayerFilter(columnPrefix = "", layers?: MemoryLayer[]): { clause: string; args: string[] } {
  const normalized = normalizeLayerList(layers);
  if (!normalized) {
    return { clause: "1 = 1", args: [] };
  }

  const clauses: string[] = [];
  for (const layer of normalized) {
    if (layer === "rule") {
      clauses.push(`(${columnPrefix}memory_layer = 'rule' OR ${columnPrefix}type = 'rule')`);
      continue;
    }

    if (layer === "working") {
      clauses.push(`${columnPrefix}memory_layer = 'working'`);
      continue;
    }

    clauses.push(`(${columnPrefix}memory_layer = 'long_term' OR (${columnPrefix}memory_layer IS NULL AND ${columnPrefix}type != 'rule'))`);
  }

  if (clauses.length === 1) {
    return { clause: clauses[0], args: [] };
  }

  return { clause: `(${clauses.join(" OR ")})`, args: [] };
}

function toFtsPrefixQuery(query: string): string | null {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return null;
  }

  return terms
    .map((term) => `"${term.replace(/"/g, "\"\"")}"*`)
    .join(" OR ");
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
  const nowIso = new Date().toISOString();
  const normalizedContent = normalizeContent(content);
  const normalizedTags = normalizeStringList(opts?.tags);
  const normalizedPaths = normalizeStringList(opts?.paths);
  const tags = normalizedTags?.length ? normalizedTags.join(",") : null;
  const type = opts?.type ?? "note";
  const layer = opts?.layer ?? defaultLayerForType(type);
  const expiresAt = layer === "working" ? workingMemoryExpiresAt(nowIso) : null;
  const upsertKey = normalizeUpsertKey(opts?.upsertKey);
  const sourceSessionId = opts?.sourceSessionId?.trim() || null;
  const confidence = normalizeConfidence(opts?.confidence);
  const lastConfirmedAt = opts?.lastConfirmedAt?.trim() || (upsertKey ? nowIso : null);
  const paths = normalizedPaths?.length ? normalizedPaths.join(",") : null;
  const category = opts?.category?.trim() ? opts.category.trim() : null;
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

  if (upsertKey) {
    const existingResult = await db.execute({
      sql: `SELECT *
            FROM memories
            WHERE scope = ?
              AND type = ?
              AND upsert_key = ?
              AND deleted_at IS NULL
              AND superseded_at IS NULL
              AND ((project_id IS NULL AND ? IS NULL) OR project_id = ?)
            LIMIT 1`,
      args: [scope, type, upsertKey, projectId, projectId],
    });
    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0] as unknown as Memory;
      await recordMemoryHistory(existing, "updated");

      await db.execute({
        sql: `UPDATE memories
              SET content = ?,
                  tags = ?,
                  memory_layer = ?,
                  expires_at = ?,
                  upsert_key = ?,
                  source_session_id = ?,
                  confidence = ?,
                  last_confirmed_at = ?,
                  paths = ?,
                  category = ?,
                  metadata = ?,
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [
          normalizedContent,
          tags,
          layer,
          expiresAt,
          upsertKey,
          sourceSessionId,
          confidence,
          lastConfirmedAt,
          paths,
          category,
          metadata,
          existing.id,
        ],
      });

      generateEmbeddingAsync(existing.id, normalizedContent);
      const updated = await db.execute({
        sql: `SELECT * FROM memories WHERE id = ?`,
        args: [existing.id],
      });
      return updated.rows[0] as unknown as Memory;
    }
  }

  await db.execute({
    sql: `INSERT INTO memories (
            id, content, tags, scope, project_id, user_id, type, memory_layer, expires_at,
            upsert_key, source_session_id, confidence, last_confirmed_at,
            paths, category, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      normalizedContent,
      tags,
      scope,
      projectId,
      null,
      type,
      layer,
      expiresAt,
      upsertKey,
      sourceSessionId,
      confidence,
      lastConfirmedAt,
      paths,
      category,
      metadata,
    ],
  });

  // Generate embedding in background (don't block on it)
  generateEmbeddingAsync(id, normalizedContent);

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
  const activeFilter = buildActiveMemoryFilter();
  const result = await db.execute({
    sql: `SELECT * FROM memories WHERE id = ? AND ${activeFilter.clause}`,
    args: [id, ...activeFilter.args],
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
  const limit = resolvePositiveLimit(opts?.limit, 20);
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const includeGlobal = opts?.includeGlobal ?? true;
  // Skip auto-detect if globalOnly is set
  const projectId = opts?.globalOnly ? undefined : (opts?.projectId ?? getProjectId());
  const layerFilter = buildLayerFilter("m.", opts?.layers);

  // Build scope filter
  const scopeConditions: string[] = [];
  const queryArgs: (string | number)[] = [];

  if (includeGlobal) {
    scopeConditions.push("m.scope = 'global'");
  }
  if (projectId) {
    scopeConditions.push("(m.scope = 'project' AND m.project_id = ?)");
    queryArgs.push(projectId);
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
    queryArgs.push(...opts.types);
  }

  // Use FTS5 for better search with ranking
  // The bm25() function returns relevance scores (lower is better)
  const ftsQuery = toFtsPrefixQuery(normalizedQuery);
  if (!ftsQuery) {
    return [];
  }
  const activeFilter = buildActiveMemoryFilter("m.");

  try {
    const result = await db.execute({
      sql: `
        SELECT m.*, bm25(memories_fts) as rank
        FROM memories m
        JOIN memories_fts fts ON m.rowid = fts.rowid
        WHERE memories_fts MATCH ?
          AND ${activeFilter.clause}
          AND ${layerFilter.clause}
          AND (${scopeConditions.join(" OR ")})
          ${typeFilter}
        ORDER BY rank ASC, m.created_at DESC
        LIMIT ?
      `,
      args: [ftsQuery, ...activeFilter.args, ...layerFilter.args, ...queryArgs, limit],
    });

    return result.rows as unknown as Memory[];
  } catch (error) {
    // Fallback to LIKE search if FTS fails (e.g., empty index)
    logger.warn("FTS search failed, falling back to LIKE:", error);
    return searchMemoriesLike(normalizedQuery, { ...opts, limit });
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
  const limit = resolvePositiveLimit(opts?.limit, 20);
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const includeGlobal = opts?.includeGlobal ?? true;
  const projectId = opts?.globalOnly ? undefined : (opts?.projectId ?? getProjectId());

  const activeFilter = buildActiveMemoryFilter();
  const layerFilter = buildLayerFilter("", opts?.layers);
  const conditions: string[] = [activeFilter.clause, layerFilter.clause, "content LIKE ?"];
  const args: (string | number)[] = [...activeFilter.args, ...layerFilter.args, `%${normalizedQuery}%`];

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
  const limit = resolvePositiveLimit(opts?.limit, 50);
  const includeGlobal = opts?.includeGlobal ?? true;
  // Skip auto-detect if globalOnly is set
  const projectId = opts?.globalOnly ? undefined : (opts?.projectId ?? getProjectId());

  const activeFilter = buildActiveMemoryFilter();
  const layerFilter = buildLayerFilter("", opts?.layers);
  const conditions: string[] = [activeFilter.clause, layerFilter.clause];
  const args: (string | number)[] = [...activeFilter.args, ...layerFilter.args];

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
  const normalizedTagFilters = normalizeStringList(opts?.tags);
  if (normalizedTagFilters?.length) {
    const tagClauses = normalizedTagFilters.map(() => `tags LIKE ?`).join(" OR ");
    conditions.push(`(${tagClauses})`);
    args.push(...normalizedTagFilters.map((t) => `%${t}%`));
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

  const activeFilter = buildActiveMemoryFilter();
  const conditions: string[] = [activeFilter.clause, "type = 'rule'"];
  const args: (string | number)[] = [...activeFilter.args];

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
  opts?: { projectId?: string; limit?: number; mode?: ContextMode }
): Promise<{ rules: Memory[]; memories: Memory[] }> {
  const projectId = opts?.projectId ?? getProjectId();
  const limit = opts?.limit ?? 10;
  const mode = opts?.mode ?? "all";

  // Always get all rules
  const rules = await getRules({ projectId: projectId ?? undefined });

  if (mode === "rules_only") {
    return { rules, memories: [] };
  }

  // If there's a query, search for relevant memories (excluding rules)
  let memories: Memory[] = [];
  if (query) {
    const layers =
      mode === "working"
        ? (["working"] as MemoryLayer[])
        : mode === "long_term"
          ? (["long_term"] as MemoryLayer[])
          : undefined;
    memories = await searchMemories(query, {
      projectId: projectId ?? undefined,
      limit,
      types: ["decision", "fact", "note"], // Exclude rules, they're already included
      layers,
    });
  }

  return { rules, memories };
}

export async function startMemorySession(opts?: StartMemorySessionOpts): Promise<MemorySession> {
  const db = await getDb();
  const id = nanoid(12);
  const now = new Date().toISOString();

  let scope: Scope = "global";
  let projectId: string | null = null;

  if (!opts?.global) {
    projectId = opts?.projectId ?? getProjectId();
    if (projectId) {
      scope = "project";
    }
  }

  const userId = opts?.userId?.trim() ? opts.userId.trim() : null;
  const client = opts?.client?.trim() ? opts.client.trim() : null;
  const title = opts?.title?.trim() ? opts.title.trim() : null;
  const metadata = opts?.metadata ? JSON.stringify(opts.metadata) : null;

  await db.execute({
    sql: `INSERT INTO memory_sessions (id, scope, project_id, user_id, client, status, title, started_at, last_activity_at, ended_at, metadata)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?)`,
    args: [id, scope, projectId, userId, client, title, now, now, metadata],
  });

  const result = await db.execute({
    sql: "SELECT * FROM memory_sessions WHERE id = ?",
    args: [id],
  });

  const session = result.rows[0] as unknown as MemorySession;

  if (isOpenClawFileModeEnabled()) {
    try {
      const bootstrapContext = await readOpenClawBootstrapContext();
      const bootstrapContent = formatOpenClawBootstrapContext(bootstrapContext);
      if (bootstrapContent) {
        await checkpointMemorySession(id, bootstrapContent, {
          role: "tool",
          kind: "summary",
          tokenCount: estimateTokensFromText(bootstrapContent),
          isMeaningful: true,
        });
      }
    } catch (error) {
      logger.warn(
        `Failed to load OpenClaw bootstrap context for session ${id}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  return session;
}

export async function getMemorySession(sessionId: string): Promise<MemorySession | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT * FROM memory_sessions WHERE id = ?",
    args: [sessionId],
  });
  return result.rows.length > 0 ? (result.rows[0] as unknown as MemorySession) : null;
}

export async function getLatestActiveMemorySession(opts?: {
  projectId?: string;
  includeGlobal?: boolean;
}): Promise<MemorySession | null> {
  const db = await getDb();
  const includeGlobal = opts?.includeGlobal ?? true;
  const projectId = opts?.projectId ?? getProjectId();

  const scopeClauses: string[] = [];
  const args: string[] = [];

  if (includeGlobal) {
    scopeClauses.push("scope = 'global'");
  }

  if (projectId) {
    scopeClauses.push("(scope = 'project' AND project_id = ?)");
    args.push(projectId);
  }

  if (scopeClauses.length === 0) {
    return null;
  }

  const orderBy = projectId
    ? "CASE WHEN scope = 'project' AND project_id = ? THEN 0 ELSE 1 END, last_activity_at DESC"
    : "last_activity_at DESC";
  const orderArgs: string[] = projectId ? [projectId] : [];

  const result = await db.execute({
    sql: `SELECT * FROM memory_sessions
          WHERE status = 'active' AND (${scopeClauses.join(" OR ")})
          ORDER BY ${orderBy}
          LIMIT 1`,
    args: [...args, ...orderArgs],
  });

  return result.rows.length > 0 ? (result.rows[0] as unknown as MemorySession) : null;
}

export async function checkpointMemorySession(
  sessionId: string,
  content: string,
  opts?: SessionCheckpointOpts
): Promise<MemorySessionEvent> {
  const db = await getDb();
  const session = await getMemorySession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (session.status !== "active") {
    throw new Error(`Cannot checkpoint session ${sessionId} because it is ${session.status}`);
  }

  const now = new Date().toISOString();
  const normalizedContent = normalizeContent(content);
  const role = opts?.role ?? "assistant";
  const kind = opts?.kind ?? "checkpoint";
  const tokenCount = opts?.tokenCount ?? null;
  const turnIndex = opts?.turnIndex ?? null;
  const isMeaningful = opts?.isMeaningful === false ? 0 : 1;
  const eventId = nanoid(12);

  await db.execute({
    sql: `INSERT INTO memory_session_events
          (id, session_id, role, kind, content, token_count, turn_index, is_meaningful, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [eventId, sessionId, role, kind, normalizedContent, tokenCount, turnIndex, isMeaningful, now],
  });

  await db.execute({
    sql: "UPDATE memory_sessions SET last_activity_at = ? WHERE id = ?",
    args: [now, sessionId],
  });

  const result = await db.execute({
    sql: "SELECT * FROM memory_session_events WHERE id = ?",
    args: [eventId],
  });

  return result.rows[0] as unknown as MemorySessionEvent;
}

export async function listMemorySessionEvents(
  sessionId: string,
  opts?: SessionEventListOpts
): Promise<MemorySessionEvent[]> {
  const db = await getDb();
  const limit = resolvePositiveLimit(opts?.limit, 15);
  const conditions: string[] = ["session_id = ?"];
  const args: (string | number)[] = [sessionId];

  if (opts?.meaningfulOnly) {
    conditions.push("is_meaningful = 1");
  }

  const result = await db.execute({
    sql: `SELECT * FROM (
            SELECT * FROM memory_session_events
            WHERE ${conditions.join(" AND ")}
            ORDER BY created_at DESC
            LIMIT ?
          )
          ORDER BY created_at ASC`,
    args: [...args, limit],
  });

  return result.rows as unknown as MemorySessionEvent[];
}

export async function createMemorySessionSnapshot(
  sessionId: string,
  opts: CreateSessionSnapshotOpts
): Promise<MemorySessionSnapshot> {
  const db = await getDb();
  const session = await getMemorySession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const now = new Date().toISOString();
  const snapshotId = nanoid(12);
  const sourceTrigger = opts.sourceTrigger ?? "manual";
  const slug = normalizeSessionSlug(opts.slug ?? `${sourceTrigger}-${now}`);
  const transcriptMd = normalizeContent(opts.transcriptMd);
  const messageCount = Math.max(0, Math.trunc(opts.messageCount));

  await db.execute({
    sql: `INSERT INTO memory_session_snapshots
          (id, session_id, slug, source_trigger, transcript_md, message_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [snapshotId, sessionId, slug, sourceTrigger, transcriptMd, messageCount, now],
  });

  await db.execute({
    sql: "UPDATE memory_sessions SET last_activity_at = ? WHERE id = ?",
    args: [now, sessionId],
  });

  const result = await db.execute({
    sql: "SELECT * FROM memory_session_snapshots WHERE id = ?",
    args: [snapshotId],
  });

  const snapshot = result.rows[0] as unknown as MemorySessionSnapshot;

  if (isOpenClawFileModeEnabled()) {
    try {
      const snapshotDocument = [
        `<!-- session_id: ${sessionId}; source_trigger: ${sourceTrigger}; created_at: ${now} -->`,
        transcriptMd,
      ].join("\n\n");
      await writeOpenClawSnapshot(snapshotDocument, {
        date: now,
        slug,
      });
    } catch (error) {
      logger.warn(
        `Failed to write OpenClaw snapshot file for session ${sessionId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  return snapshot;
}

export async function endMemorySession(
  sessionId: string,
  opts?: EndMemorySessionOpts
): Promise<MemorySession | null> {
  const db = await getDb();
  const existing = await getMemorySession(sessionId);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const status = opts?.status ?? "closed";
  await db.execute({
    sql: "UPDATE memory_sessions SET status = ?, ended_at = ?, last_activity_at = ? WHERE id = ?",
    args: [status, now, now, sessionId],
  });

  const result = await db.execute({
    sql: "SELECT * FROM memory_sessions WHERE id = ?",
    args: [sessionId],
  });

  return result.rows[0] as unknown as MemorySession;
}

export async function getMemorySessionStatus(sessionId: string): Promise<MemorySessionStatusSummary | null> {
  const db = await getDb();
  const session = await getMemorySession(sessionId);
  if (!session) {
    return null;
  }

  const eventStats = await db.execute({
    sql: "SELECT COUNT(*) AS count, MAX(created_at) AS latest_at FROM memory_session_events WHERE session_id = ?",
    args: [sessionId],
  });
  const snapshotStats = await db.execute({
    sql: "SELECT COUNT(*) AS count, MAX(created_at) AS latest_at FROM memory_session_snapshots WHERE session_id = ?",
    args: [sessionId],
  });
  const checkpointStats = await db.execute({
    sql: "SELECT COUNT(*) AS count FROM memory_session_events WHERE session_id = ? AND kind = 'checkpoint'",
    args: [sessionId],
  });
  const latestCheckpoint = await db.execute({
    sql: `SELECT id, created_at
          FROM memory_session_events
          WHERE session_id = ? AND kind = 'checkpoint'
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [sessionId],
  });

  const eventRow = eventStats.rows[0];
  const snapshotRow = snapshotStats.rows[0];
  const checkpointRow = checkpointStats.rows[0];
  const latestCheckpointRow = latestCheckpoint.rows[0];

  return {
    session,
    eventCount: coerceCount(eventRow?.count),
    checkpointCount: coerceCount(checkpointRow?.count),
    snapshotCount: coerceCount(snapshotRow?.count),
    latestEventAt: typeof eventRow?.latest_at === "string" ? eventRow.latest_at : null,
    latestSnapshotAt: typeof snapshotRow?.latest_at === "string" ? snapshotRow.latest_at : null,
    latestCheckpointId: typeof latestCheckpointRow?.id === "string" ? latestCheckpointRow.id : null,
    latestCheckpointAt: typeof latestCheckpointRow?.created_at === "string" ? latestCheckpointRow.created_at : null,
  };
}

export function estimateContextTokenCount(args: { rules: Memory[]; memories: Memory[] }): number {
  let total = 24;

  for (const rule of args.rules) {
    total += 8 + estimateTokensFromText(rule.content);
    if (rule.tags) {
      total += estimateTokensFromText(rule.tags);
    }
  }

  for (const memory of args.memories) {
    total += 12 + estimateTokensFromText(memory.content);
    if (memory.tags) {
      total += estimateTokensFromText(memory.tags);
    }
    if (memory.category) {
      total += estimateTokensFromText(memory.category);
    }
  }

  return total;
}

export async function logMemoryCompactionEvent(input: {
  sessionId: string;
  triggerType: CompactionTriggerType;
  reason: string;
  tokenCountBefore?: number | null;
  turnCountBefore?: number | null;
  summaryTokens?: number | null;
  checkpointMemoryId?: string | null;
}): Promise<MemoryCompactionEvent> {
  const db = await getDb();
  const session = await getMemorySession(input.sessionId);
  if (!session) {
    throw new Error(`Session ${input.sessionId} not found`);
  }

  const eventId = nanoid(12);
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO memory_compaction_events
          (id, session_id, trigger_type, reason, token_count_before, turn_count_before, summary_tokens, checkpoint_memory_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      eventId,
      input.sessionId,
      input.triggerType,
      input.reason.trim(),
      input.tokenCountBefore ?? null,
      input.turnCountBefore ?? null,
      input.summaryTokens ?? null,
      input.checkpointMemoryId ?? null,
      now,
    ],
  });

  const result = await db.execute({
    sql: "SELECT * FROM memory_compaction_events WHERE id = ?",
    args: [eventId],
  });
  return result.rows[0] as unknown as MemoryCompactionEvent;
}

export async function writeAheadCompactionCheckpoint(
  sessionId: string,
  opts: WriteAheadCompactionOpts
): Promise<{
  checkpointEvent: MemorySessionEvent;
  compactionEvent: MemoryCompactionEvent;
  tokenCountBefore: number;
  openClawDailyLogPath: string | null;
}> {
  const tokenCountBefore = opts.tokenCountBefore ?? estimateContextTokenCount({
    rules: opts.rules,
    memories: opts.memories,
  });
  const triggerType = opts.triggerType ?? "count";
  const reason =
    opts.reason?.trim() ||
    `Context estimated at ${tokenCountBefore} tokens before compaction checkpoint.`;

  let checkpointContent = opts.checkpointContent?.trim();
  if (!checkpointContent) {
    const summaryLines: string[] = [
      "Compaction checkpoint (write-ahead log).",
      `Trigger: ${triggerType}`,
      `Reason: ${reason}`,
    ];

    if (opts.query?.trim()) {
      summaryLines.push(`Query: ${opts.query.trim()}`);
    }

    if (opts.rules.length > 0) {
      const ruleLines = opts.rules
        .slice(0, 5)
        .map((rule) => `- ${truncateForSummary(rule.content)}`);
      summaryLines.push("Rules:");
      summaryLines.push(...ruleLines);
    }

    if (opts.memories.length > 0) {
      const memoryLines = opts.memories
        .slice(0, 8)
        .map((memory) => `- [${memory.type}] ${truncateForSummary(memory.content)}`);
      summaryLines.push("Memories:");
      summaryLines.push(...memoryLines);
    }

    checkpointContent = summaryLines.join("\n");
  }

  const summaryTokens = estimateTokensFromText(checkpointContent);
  const checkpointEvent = await checkpointMemorySession(sessionId, checkpointContent, {
    role: "assistant",
    kind: "checkpoint",
    tokenCount: summaryTokens,
    isMeaningful: true,
  });

  const compactionEvent = await logMemoryCompactionEvent({
    sessionId,
    triggerType,
    reason,
    tokenCountBefore,
    turnCountBefore: opts.turnCountBefore ?? null,
    summaryTokens,
    checkpointMemoryId: checkpointEvent.id,
  });

  let openClawDailyLogPath: string | null = null;
  if (isOpenClawFileModeEnabled()) {
    try {
      const flushPayload = [
        `- Session: ${sessionId}`,
        `- Trigger: ${triggerType}`,
        `- Reason: ${reason}`,
        `- Checkpoint event: ${checkpointEvent.id}`,
        `- Compaction event: ${compactionEvent.id}`,
        "",
        checkpointContent,
      ].join("\n");
      const flushResult = await appendOpenClawDailyLog(flushPayload, {
        heading: `## Compaction checkpoint · ${new Date().toISOString()}`,
      });
      openClawDailyLogPath = flushResult.route.absolutePath;
    } catch (error) {
      logger.warn(
        `Failed to flush OpenClaw pre-compaction checkpoint for session ${sessionId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  return {
    checkpointEvent,
    compactionEvent,
    tokenCountBefore,
    openClawDailyLogPath,
  };
}

export async function runInactivityCompactionWorker(opts?: {
  inactivityMinutes?: number;
  limit?: number;
  eventWindow?: number;
}): Promise<InactivityCompactionWorkerResult> {
  const db = await getDb();
  const inactivityMinutes = resolvePositiveLimit(opts?.inactivityMinutes, 60);
  const limit = resolvePositiveLimit(opts?.limit, 25);
  const eventWindow = resolvePositiveLimit(opts?.eventWindow, 8);
  const cutoffIso = new Date(Date.now() - inactivityMinutes * 60 * 1000).toISOString();

  const result = await db.execute({
    sql: `SELECT id
          FROM memory_sessions
          WHERE status = 'active' AND last_activity_at <= ?
          ORDER BY last_activity_at ASC
          LIMIT ?`,
    args: [cutoffIso, limit],
  });

  const sessionIds = result.rows
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((value): value is string => Boolean(value));

  const failures: Array<{ sessionId: string; error: string }> = [];
  let checkpointed = 0;

  for (const sessionId of sessionIds) {
    try {
      const recentEvents = await listMemorySessionEvents(sessionId, {
        limit: eventWindow,
        meaningfulOnly: true,
      });
      const eventSummary = recentEvents.length > 0
        ? recentEvents.map((event) => `- [${event.role}/${event.kind}] ${truncateForSummary(event.content, 200)}`).join("\n")
        : "- No meaningful events recorded before inactivity checkpoint.";

      await writeAheadCompactionCheckpoint(sessionId, {
        triggerType: "time",
        reason: `Session inactive for at least ${inactivityMinutes} minutes.`,
        rules: [],
        memories: [],
        checkpointContent: [
          "Compaction checkpoint (inactivity worker).",
          `Reason: Session inactive for at least ${inactivityMinutes} minutes.`,
          "Recent meaningful events:",
          eventSummary,
        ].join("\n"),
      });

      await endMemorySession(sessionId, { status: "compacted" });
      checkpointed += 1;
    } catch (error) {
      failures.push({
        sessionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    inactivityMinutes,
    scanned: sessionIds.length,
    checkpointed,
    compacted: checkpointed,
    failures,
  };
}

async function ensureMemoryLinksTable(): Promise<void> {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'related',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_links_source ON memory_links(source_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_id)`);
}

async function ensureMemoryLink(sourceId: string, targetId: string, linkType: "supersedes" | "contradicts"): Promise<void> {
  const db = await getDb();
  const existing = await db.execute({
    sql: `SELECT id FROM memory_links
          WHERE source_id = ? AND target_id = ? AND link_type = ?
          LIMIT 1`,
    args: [sourceId, targetId, linkType],
  });
  if (existing.rows.length > 0) {
    return;
  }

  await db.execute({
    sql: `INSERT INTO memory_links (id, source_id, target_id, link_type, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [nanoid(12), sourceId, targetId, linkType, new Date().toISOString()],
  });
}

function normalizeComparableContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export async function consolidateMemories(opts: ConsolidateMemoriesOpts = {}): Promise<ConsolidateMemoriesResult> {
  const db = await getDb();
  const includeGlobal = opts.includeGlobal ?? true;
  const projectId = opts.globalOnly ? undefined : (opts.projectId ?? getProjectId());
  const types = opts.types && opts.types.length > 0
    ? opts.types
    : (["rule", "decision", "fact", "note"] as MemoryType[]);
  const nowIso = new Date().toISOString();

  const scopeClauses: string[] = [];
  const args: (string | number)[] = [];
  if (includeGlobal) {
    scopeClauses.push("scope = 'global'");
  }
  if (projectId) {
    scopeClauses.push("(scope = 'project' AND project_id = ?)");
    args.push(projectId);
  }
  if (scopeClauses.length === 0) {
    scopeClauses.push("scope = 'global' AND 1 = 0");
  }

  const typePlaceholders = types.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `SELECT *
          FROM memories
          WHERE deleted_at IS NULL
            AND superseded_at IS NULL
            AND (${scopeClauses.join(" OR ")})
            AND type IN (${typePlaceholders})`,
    args: [...args, ...types],
  });
  const candidates = result.rows as unknown as Memory[];

  const groups = new Map<string, Memory[]>();
  const winnerMemoryIds: string[] = [];
  const supersededMemoryIds: string[] = [];

  for (const memory of candidates) {
    const upsertKey = normalizeUpsertKey(memory.upsert_key ?? undefined) ?? deriveUpsertKey(memory);
    if (!upsertKey) continue;

    const groupKey = `${memory.scope}|${memory.project_id ?? "global"}|${memory.type}|${upsertKey}`;
    const list = groups.get(groupKey) ?? [];
    list.push(memory);
    groups.set(groupKey, list);

    if (!opts.dryRun && !memory.upsert_key) {
      await db.execute({
        sql: "UPDATE memories SET upsert_key = ?, updated_at = datetime('now') WHERE id = ?",
        args: [upsertKey, memory.id],
      });
    }
  }

  let mergedCount = 0;
  let conflictedCount = 0;

  if (!opts.dryRun) {
    await ensureMemoryLinksTable();
  }

  for (const [groupKey, group] of groups) {
    if (group.length <= 1) continue;

    const groupParts = groupKey.split("|");
    const upsertKey = groupParts[groupParts.length - 1];
    const sorted = [...group].sort((a, b) => {
      const updatedDiff = parseTimestamp(b.updated_at) - parseTimestamp(a.updated_at);
      if (updatedDiff !== 0) return updatedDiff;
      return parseTimestamp(b.created_at) - parseTimestamp(a.created_at);
    });
    const winner = sorted[0];
    const losers = sorted.slice(1);
    mergedCount += 1;
    winnerMemoryIds.push(winner.id);

    if (!opts.dryRun) {
      await db.execute({
        sql: `UPDATE memories
              SET upsert_key = ?, confidence = COALESCE(confidence, 1.0), last_confirmed_at = COALESCE(last_confirmed_at, ?), updated_at = datetime('now')
              WHERE id = ?`,
        args: [upsertKey, nowIso, winner.id],
      });
    }

    for (const loser of losers) {
      const conflicting = normalizeComparableContent(loser.content) !== normalizeComparableContent(winner.content);
      if (conflicting) {
        conflictedCount += 1;
      }
      supersededMemoryIds.push(loser.id);

      if (opts.dryRun) continue;

      await db.execute({
        sql: `UPDATE memories
              SET superseded_by = ?, superseded_at = ?, upsert_key = ?, updated_at = datetime('now')
              WHERE id = ?`,
        args: [winner.id, nowIso, upsertKey, loser.id],
      });
      await ensureMemoryLink(winner.id, loser.id, "supersedes");
      if (conflicting) {
        await ensureMemoryLink(winner.id, loser.id, "contradicts");
      }
    }
  }

  const run: MemoryConsolidationRun = {
    id: nanoid(12),
    scope: projectId ? "project" : "global",
    project_id: projectId ?? null,
    user_id: null,
    input_count: candidates.length,
    merged_count: mergedCount,
    superseded_count: supersededMemoryIds.length,
    conflicted_count: conflictedCount,
    model: opts.model ?? null,
    created_at: nowIso,
    metadata: JSON.stringify({
      dryRun: Boolean(opts.dryRun),
      includeGlobal,
      types,
      candidateGroups: groups.size,
    }),
  };

  await db.execute({
    sql: `INSERT INTO memory_consolidation_runs
          (id, scope, project_id, user_id, input_count, merged_count, superseded_count, conflicted_count, model, created_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      run.id,
      run.scope,
      run.project_id,
      run.user_id,
      run.input_count,
      run.merged_count,
      run.superseded_count,
      run.conflicted_count,
      run.model,
      run.created_at,
      run.metadata,
    ],
  });

  return {
    run,
    supersededMemoryIds,
    winnerMemoryIds,
  };
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
