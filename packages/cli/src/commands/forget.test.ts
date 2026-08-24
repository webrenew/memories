import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-forget-test-"));

import { addMemory, forgetMemory, getMemoryById, findMemoriesToForget, bulkForgetByIds } from "../lib/memory.js";
import { getDb } from "../lib/db.js";

describe("forget", () => {
  beforeAll(async () => {
    await getDb();
  });

  it("should soft-delete a memory by ID", async () => {
    const memory = await addMemory("Temporary note", { type: "note", global: true });
    const deleted = await forgetMemory(memory.id);
    expect(deleted).toBe(true);

    const fetched = await getMemoryById(memory.id);
    expect(fetched).toBeNull();
  });

  it("should return false for non-existent ID", async () => {
    const deleted = await forgetMemory("nonexistent-id-xyz");
    expect(deleted).toBe(false);
  });

  it("should not double-delete a memory", async () => {
    const memory = await addMemory("Another temp note", { type: "note", global: true });
    await forgetMemory(memory.id);
    const secondDelete = await forgetMemory(memory.id);
    expect(secondDelete).toBe(false);
  });

  it("should find memories matching a type filter for bulk forget", async () => {
    await addMemory("Bulk fact 1", { type: "fact", global: true });
    await addMemory("Bulk fact 2", { type: "fact", global: true });
    await addMemory("Bulk rule 1", { type: "rule", global: true });

    const matches = await findMemoriesToForget({ types: ["fact"] });
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) {
      expect(m.type).toBe("fact");
    }
  });

  it("should bulk forget by IDs", async () => {
    const m1 = await addMemory("To delete 1", { type: "note", global: true });
    const m2 = await addMemory("To delete 2", { type: "note", global: true });
    const count = await bulkForgetByIds([m1.id, m2.id]);
    expect(count).toBe(2);

    expect(await getMemoryById(m1.id)).toBeNull();
    expect(await getMemoryById(m2.id)).toBeNull();

    const db = await getDb();
    const graphNodes = await db.execute({
      sql: "SELECT node_key FROM graph_nodes WHERE node_type = 'memory' AND node_key IN (?, ?)",
      args: [m1.id, m2.id],
    });
    expect(graphNodes.rows).toHaveLength(0);
  });
});
