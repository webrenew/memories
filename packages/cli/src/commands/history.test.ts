import { describe, it, expect, beforeAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-history-test-"));

import { addMemory, updateMemory, getMemoryById } from "../lib/memory.js";
import { getDb } from "../lib/db.js";
import { historyCommand, revertCommand } from "./history.js";

async function ensureHistoryTable(): Promise<void> {
  const db = await getDb();
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
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_history_memory ON memory_history(memory_id)`);
}

describe("history", () => {
  let memoryId: string;

  beforeAll(async () => {
    await getDb();
    await ensureHistoryTable();
    const memory = await addMemory("Original content", { type: "rule", global: true });
    memoryId = memory.id;

    // Record initial history entry
    const db = await getDb();
    await db.execute({
      sql: "INSERT INTO memory_history (id, memory_id, content, type, change_type) VALUES (?, ?, ?, ?, ?)",
      args: [`${memoryId}-1`, memoryId, "Original content", "rule", "created"],
    });
  });

  it("should record history when memory is created", async () => {
    const db = await getDb();
    const result = await db.execute({
      sql: "SELECT * FROM memory_history WHERE memory_id = ?",
      args: [memoryId],
    });
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    expect(result.rows[0].change_type).toBe("created");
  });

  it("should track content changes in history", async () => {
    const db = await getDb();
    // Record an update
    await db.execute({
      sql: "INSERT INTO memory_history (id, memory_id, content, type, change_type) VALUES (?, ?, ?, ?, ?)",
      args: [`${memoryId}-2`, memoryId, "Updated content", "rule", "updated"],
    });

    const result = await db.execute({
      sql: "SELECT * FROM memory_history WHERE memory_id = ? ORDER BY changed_at",
      args: [memoryId],
    });
    expect(result.rows.length).toBe(2);
    expect(result.rows[1].change_type).toBe("updated");
  });

  it("should retrieve history with version numbers", async () => {
    const db = await getDb();
    const result = await db.execute({
      sql: `SELECT *, ROW_NUMBER() OVER (ORDER BY changed_at ASC) as version
            FROM memory_history
            WHERE memory_id = ?
            ORDER BY changed_at ASC`,
      args: [memoryId],
    });
    expect(result.rows.length).toBe(2);
    // First entry should be "created"
    expect(result.rows[0].change_type).toBe("created");
    // Second should be "updated"
    expect(result.rows[1].change_type).toBe("updated");
  });

  it("should return empty history for non-existent memory", async () => {
    const db = await getDb();
    const result = await db.execute({
      sql: "SELECT * FROM memory_history WHERE memory_id = ?",
      args: ["nonexistent-id-xyz"],
    });
    expect(result.rows.length).toBe(0);
  });

  it("keeps tied history versions ordered and records a restore only once", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1792710000000);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Unexpected exit: ${code}`);
    });
    try {
      const memory = await addMemory("Before restore", { global: true });
      await updateMemory(memory.id, { content: "After edit" });
      await updateMemory(memory.id, { content: "After second edit" });
      const db = await getDb();
      await db.execute({
        sql: "UPDATE memory_history SET changed_at = '2000-01-01 00:00:00' WHERE memory_id = ?",
        args: [memory.id],
      });
      await historyCommand.parseAsync(["node", "memories", memory.id, "--json"]);
      const displayed = JSON.parse(output.mock.calls.at(-1)?.[0] as string);
      expect(displayed.history.map((row: { version: number }) => row.version)).toEqual([2, 1]);
      expect(displayed.history.map((row: { content: string }) => row.content)).toEqual([
        "After edit", "Before restore",
      ]);
      await revertCommand.parseAsync(["node", "memories", memory.id, "--to", "2"]);
      expect(exit).not.toHaveBeenCalled();
      expect((await getMemoryById(memory.id))?.content).toBe("After edit");
      const history = await db.execute({
        sql: "SELECT id FROM memory_history WHERE memory_id = ?",
        args: [memory.id],
      });
      expect(history.rows).toHaveLength(3);
      expect(new Set(history.rows.map((row) => row.id)).size).toBe(3);
    } finally {
      clock.mockRestore();
      output.mockRestore();
      exit.mockRestore();
    }
  });
});
