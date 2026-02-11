import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Must be set before any db import
process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-db-test-"));

import { getDb, resetDb } from "./db.js";

const GRAPH_TABLES = ["graph_nodes", "graph_edges", "memory_node_links"];
const GRAPH_INDEXES = [
  "idx_graph_nodes_type_key",
  "idx_graph_nodes_type",
  "idx_graph_edges_from_node_id",
  "idx_graph_edges_to_node_id",
  "idx_graph_edges_type_from_node_id",
  "idx_graph_edges_expires_at",
  "idx_memory_node_links_node_id",
  "idx_memory_node_links_memory_id",
];

describe("db graph migrations", () => {
  beforeAll(async () => {
    await getDb();
  });

  it("creates graph tables and indexes", async () => {
    const db = await getDb();

    for (const table of GRAPH_TABLES) {
      const result = await db.execute({
        sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        args: [table],
      });
      expect(result.rows.length).toBe(1);
    }

    for (const indexName of GRAPH_INDEXES) {
      const result = await db.execute({
        sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
        args: [indexName],
      });
      expect(result.rows.length).toBe(1);
    }
  });

  it("enforces unique graph node keys per type", async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    const nodeType = "repo";
    const nodeIdA = `node-a-${Date.now()}`;
    const nodeIdB = `node-b-${Date.now()}`;
    const nodeKey = `github.com/webrenew/memories-${Date.now()}`;

    await db.execute({
      sql: `INSERT INTO graph_nodes (id, node_type, node_key, label, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [nodeIdA, nodeType, nodeKey, "Memories", now, now],
    });

    await expect(
      db.execute({
        sql: `INSERT INTO graph_nodes (id, node_type, node_key, label, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [nodeIdB, nodeType, nodeKey, "Memories Duplicate", now, now],
      })
    ).rejects.toThrow();
  });

  it("runs graph migrations idempotently across reconnects", async () => {
    resetDb();
    const db = await getDb();

    const result = await db.execute({
      sql: "SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?)",
      args: GRAPH_TABLES,
    });

    expect(Number(result.rows[0]?.count)).toBe(GRAPH_TABLES.length);
  });
});
