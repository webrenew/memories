import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Use a temp directory so tests never hit sync
process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-test-"));

import { addMemory, searchMemories, listMemories, forgetMemory, getMemoryById } from "./memory.js";
import { getDb } from "./db.js";

describe("memory", () => {
  it("should add a memory", async () => {
    const memory = await addMemory("test memory content", {
      tags: ["test", "smoke"],
    });
    expect(memory.id).toBeDefined();
    expect(memory.content).toBe("test memory content");
    expect(memory.tags).toBe("test,smoke");
  });

  it("should default memory layer based on type", async () => {
    const ruleMemory = await addMemory("rule memory content", {
      global: true,
      type: "rule",
    });
    const noteMemory = await addMemory("note memory content", {
      global: true,
      type: "note",
    });

    expect(ruleMemory.memory_layer).toBe("rule");
    expect(noteMemory.memory_layer).toBe("long_term");
    expect(ruleMemory.expires_at).toBeNull();
    expect(noteMemory.expires_at).toBeNull();
  });

  it("should assign an expiry for working-layer memories", async () => {
    const startedAt = Date.now();
    const memory = await addMemory("working layer memory", {
      global: true,
      layer: "working",
    });

    expect(memory.memory_layer).toBe("working");
    expect(memory.expires_at).toBeTruthy();

    const expiresAt = new Date(memory.expires_at as string).getTime();
    expect(Number.isFinite(expiresAt)).toBe(true);
    expect(expiresAt).toBeGreaterThan(startedAt);
  });

  it("should normalize content, tags, paths, and category", async () => {
    const memory = await addMemory("  normalized memory  ", {
      global: true,
      tags: [" urgent ", "", "urgent", "api", "api "],
      paths: [" src/api/** ", "", "src/api/**", "src/routes/**"],
      category: "  quality  ",
    });

    expect(memory.content).toBe("normalized memory");
    expect(memory.tags).toBe("urgent,api");
    expect(memory.paths).toBe("src/api/**,src/routes/**");
    expect(memory.category).toBe("quality");
  });

  it("should reject empty memory content", async () => {
    await expect(addMemory("   ", { global: true })).rejects.toThrow("Memory content cannot be empty");
  });

  it("should search memories by content", async () => {
    await addMemory("searchable unique phrase");
    const results = await searchMemories("searchable unique");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("searchable unique");
  });

  it("should return no results for empty search query", async () => {
    await addMemory("query guard memory", { global: true });
    const results = await searchMemories("   ");
    expect(results).toEqual([]);
  });

  it("should use fallback limits for invalid or non-positive limit values", async () => {
    await addMemory("limit guard alpha", { global: true, tags: ["limit-guard"] });
    await addMemory("limit guard beta", { global: true, tags: ["limit-guard"] });

    const invalidSearchLimit = await searchMemories("limit guard", { limit: Number.NaN });
    expect(invalidSearchLimit.length).toBeGreaterThan(0);

    const invalidListLimit = await listMemories({ tags: ["limit-guard"], limit: 0 });
    expect(invalidListLimit.length).toBeGreaterThan(0);
  });

  it("should list memories", async () => {
    const results = await listMemories();
    expect(results.length).toBeGreaterThan(0);
  });

  it("should list memories filtered by tags", async () => {
    await addMemory("tagged item", { tags: ["filtertest"] });
    const results = await listMemories({ tags: ["filtertest"] });
    expect(results.length).toBeGreaterThan(0);
  });

  it("should ignore empty tag filters instead of matching everything", async () => {
    await addMemory("tag filter target", { global: true, tags: ["target-tag-filter"] });
    const results = await listMemories({ tags: ["", " target-tag-filter ", ""] });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((memory) => (memory.tags ?? "").includes("target-tag-filter"))).toBe(true);
  });

  it("should soft-delete a memory", async () => {
    const uniqueContent = "to-be-forgotten-unique-token-12345";
    const memory = await addMemory(uniqueContent);
    const deleted = await forgetMemory(memory.id);
    expect(deleted).toBe(true);

    const fetched = await getMemoryById(memory.id);
    expect(fetched).toBeNull();

    const results = await searchMemories(uniqueContent);
    expect(results.length).toBe(0);
  });

  it("should hide expired working memories from read paths", async () => {
    const token = `expired-working-${Date.now()}`;
    const tag = `expired-working-tag-${Date.now()}`;
    const memory = await addMemory(token, {
      global: true,
      layer: "working",
      tags: [tag],
    });

    const db = await getDb();
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await db.execute({
      sql: "UPDATE memories SET expires_at = ? WHERE id = ?",
      args: [expiredAt, memory.id],
    });

    const fetched = await getMemoryById(memory.id);
    expect(fetched).toBeNull();

    const searched = await searchMemories(token, { globalOnly: true });
    expect(searched.some((entry) => entry.id === memory.id)).toBe(false);

    const listed = await listMemories({ globalOnly: true, tags: [tag], limit: 200 });
    expect(listed.some((entry) => entry.id === memory.id)).toBe(false);
  });

  it("should return false when forgetting non-existent id", async () => {
    const deleted = await forgetMemory("nonexistent");
    expect(deleted).toBe(false);
  });

  it("should add global memory when global flag is true", async () => {
    const memory = await addMemory("global preference", { global: true });
    expect(memory.scope).toBe("global");
    expect(memory.project_id).toBeNull();
  });

  it("should add project memory when projectId is provided", async () => {
    const memory = await addMemory("project specific", {
      projectId: "github.com/test/repo",
    });
    expect(memory.scope).toBe("project");
    expect(memory.project_id).toBe("github.com/test/repo");
  });

  it("should filter memories by scope", async () => {
    // Add global and project memories
    await addMemory("scope-test global", { global: true, tags: ["scope-test"] });
    await addMemory("scope-test project", { projectId: "github.com/scope/test", tags: ["scope-test"] });

    // List with only project scope
    const projectOnly = await listMemories({
      projectId: "github.com/scope/test",
      includeGlobal: false,
      tags: ["scope-test"],
    });
    expect(projectOnly.every((m) => m.scope === "project")).toBe(true);

    // List with both scopes
    const both = await listMemories({
      projectId: "github.com/scope/test",
      includeGlobal: true,
      tags: ["scope-test"],
    });
    expect(both.some((m) => m.scope === "global")).toBe(true);
    expect(both.some((m) => m.scope === "project")).toBe(true);
  });
});
