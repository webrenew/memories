import { getDb } from "./db.js";
import type { MemoryType, Memory } from "./memory.js";

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
