import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-stale-test-"));

import { addMemory } from "../lib/memory.js";
import { getDb } from "../lib/db.js";

describe("stale", () => {
  beforeAll(async () => {
    await getDb();
    // Add a memory and backdate it to 100 days ago
    await addMemory("Old stale memory", { type: "note", global: true });
    const db = await getDb();
    await db.execute(
      "UPDATE memories SET created_at = datetime('now', '-100 days'), updated_at = datetime('now', '-100 days') WHERE content = 'Old stale memory'"
    );
    // Add a superseded stale memory (should be excluded by default review filters)
    await addMemory("Superseded stale memory", { type: "note", global: true });
    await db.execute(
      "UPDATE memories SET created_at = datetime('now', '-100 days'), updated_at = datetime('now', '-100 days'), superseded_by = 'winner-1', superseded_at = datetime('now', '-1 day') WHERE content = 'Superseded stale memory'"
    );
    // Add a recent memory
    await addMemory("Fresh memory", { type: "note", global: true });
  });

  it("should find stale memories older than threshold", async () => {
    const db = await getDb();
    const days = 90;
    const result = await db.execute({
      sql: `
        SELECT id, content, type, scope, created_at, updated_at,
               CAST((julianday('now') - julianday(COALESCE(updated_at, created_at))) AS INTEGER) as days_old
        FROM memories
        WHERE deleted_at IS NULL
          AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) > ?
        ORDER BY days_old DESC
      `,
      args: [days],
    });

    const stale = result.rows;
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(String(stale[0].content)).toBe("Old stale memory");
    expect(Number(stale[0].days_old)).toBeGreaterThan(90);
  });

  it("should not include fresh memories", async () => {
    const db = await getDb();
    const result = await db.execute({
      sql: `
        SELECT content FROM memories
        WHERE deleted_at IS NULL
          AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) > 90
      `,
      args: [],
    });

    const contents = result.rows.map(r => String(r.content));
    expect(contents).not.toContain("Fresh memory");
  });

  it("should support custom staleness threshold", async () => {
    const db = await getDb();
    // With a threshold of 1 day, both should be included
    const result = await db.execute({
      sql: `
        SELECT content FROM memories
        WHERE deleted_at IS NULL
          AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) > 200
      `,
      args: [],
    });

    // 200-day threshold: nothing should be that old
    expect(result.rows.length).toBe(0);
  });

  it("should exclude superseded memories when applying default stale filters", async () => {
    const db = await getDb();
    const result = await db.execute({
      sql: `
        SELECT content FROM memories m
        WHERE m.deleted_at IS NULL
          AND m.superseded_at IS NULL
          AND (julianday('now') - julianday(COALESCE(m.updated_at, m.created_at))) > 90
      `,
      args: [],
    });

    const contents = result.rows.map((r) => String(r.content));
    expect(contents).toContain("Old stale memory");
    expect(contents).not.toContain("Superseded stale memory");
  });
});
