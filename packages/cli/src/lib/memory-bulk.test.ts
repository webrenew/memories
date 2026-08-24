import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-bulk-test-"));

import { getDb } from "./db.js";
import { addMemory, getMemoryById } from "./memory.js";
import { bulkForgetByIds, findMemoriesToForget, vacuumMemories } from "./memory-bulk.js";

describe("memory bulk", () => {
  beforeAll(async () => {
    await getDb();
  });

  it("returns no matches when projectOnly is requested without projectId", async () => {
    await addMemory("global memory only", { global: true, type: "note" });

    const matches = await findMemoriesToForget({ projectOnly: true });
    expect(matches).toEqual([]);
  });

  it("normalizes tag filters by trimming and dropping empty entries", async () => {
    const target = await addMemory("tag normalized target", {
      global: true,
      type: "note",
      tags: ["bulk-filter-target"],
    });
    const other = await addMemory("tag normalized other", {
      global: true,
      type: "note",
      tags: ["different-tag"],
    });

    const matches = await findMemoriesToForget({
      tags: ["", "   ", " bulk-filter-target ", "bulk-filter-target"],
    });

    expect(matches.some((memory) => memory.id === target.id)).toBe(true);
    expect(matches.some((memory) => memory.id === other.id)).toBe(false);
  });

  it("returns actual affected rows for duplicate and unknown IDs", async () => {
    const one = await addMemory("bulk delete count one", { global: true, type: "note" });
    const two = await addMemory("bulk delete count two", { global: true, type: "note" });

    const count = await bulkForgetByIds([one.id, one.id, two.id, "missing-id", ""]);
    expect(count).toBe(2);
    expect(await getMemoryById(one.id)).toBeNull();
    expect(await getMemoryById(two.id)).toBeNull();
  });

  it("keeps graph mappings when the vacuum delete fails", async () => {
    const memory = await addMemory("vacuum failure preserves graph", {
      global: true,
      type: "note",
    });
    const db = await getDb();
    await db.execute({
      sql: "UPDATE memories SET deleted_at = datetime('now') WHERE id = ?",
      args: [memory.id],
    });
    await db.execute(`
      CREATE TRIGGER fail_vacuum_memory_delete
      BEFORE DELETE ON memories
      WHEN OLD.id = '${memory.id}'
      BEGIN
        SELECT RAISE(FAIL, 'forced vacuum failure');
      END;
    `);

    await expect(vacuumMemories()).rejects.toThrow("forced vacuum failure");

    const remainingMemory = await db.execute({
      sql: "SELECT id FROM memories WHERE id = ?",
      args: [memory.id],
    });
    const remainingGraphNode = await db.execute({
      sql: "SELECT id FROM graph_nodes WHERE node_type = 'memory' AND node_key = ?",
      args: [memory.id],
    });
    expect(remainingMemory.rows).toHaveLength(1);
    expect(remainingGraphNode.rows).toHaveLength(1);

    await db.execute("DROP TRIGGER fail_vacuum_memory_delete");
    await vacuumMemories();
  });
});
