import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-search-test-"));

import { addMemory, searchMemories } from "../lib/memory.js";
import { getDb } from "../lib/db.js";

describe("search", () => {
  beforeAll(async () => {
    await getDb();
    await addMemory("Always use TypeScript strict mode", { type: "rule", global: true });
    await addMemory("API rate limit is 100 requests per minute", { type: "fact", global: true });
    await addMemory("Chose PostgreSQL for JSONB support", { type: "decision", global: true });
    await addMemory("Meeting notes from January standup", { type: "note", global: true });
    await addMemory("Deployment draft checklist", { type: "note", layer: "working", global: true });
    await addMemory("Deployment runbook finalized", { type: "fact", layer: "long_term", global: true });
  });

  it("should find memories by keyword", async () => {
    const results = await searchMemories("TypeScript", { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("TypeScript");
  });

  it("should return empty for non-matching query", async () => {
    const results = await searchMemories("xyznonexistent123", { limit: 10 });
    expect(results.length).toBe(0);
  });

  it("should filter search by type", async () => {
    const results = await searchMemories("rate", { limit: 10, types: ["fact"] });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.type).toBe("fact");
    }
  });

  it("should respect limit", async () => {
    const results = await searchMemories("a", { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("should filter search by layer", async () => {
    const working = await searchMemories("Deployment", { limit: 10, layers: ["working"] });
    expect(working.length).toBeGreaterThan(0);
    expect(working.every((entry) => entry.memory_layer === "working")).toBe(true);

    const longTerm = await searchMemories("Deployment", { limit: 10, layers: ["long_term"] });
    expect(longTerm.length).toBeGreaterThan(0);
    expect(longTerm.some((entry) => entry.content.includes("runbook finalized"))).toBe(true);
    expect(longTerm.every((entry) => entry.memory_layer === "long_term" || entry.memory_layer === null)).toBe(true);
  });
});
