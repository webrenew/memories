import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Use a temp directory so tests never hit sync
process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-test-"));

import {
  addMemory,
  searchMemories,
  listMemories,
  forgetMemory,
  getMemoryById,
  startMemorySession,
  checkpointMemorySession,
  listMemorySessionEvents,
  createMemorySessionSnapshot,
  getMemorySessionStatus,
  endMemorySession,
  getLatestActiveMemorySession,
  estimateContextTokenCount,
  writeAheadCompactionCheckpoint,
  runInactivityCompactionWorker,
} from "./memory.js";
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

  it("should support session lifecycle operations", async () => {
    const session = await startMemorySession({
      global: true,
      title: "Lifecycle test session",
      client: "vitest",
    });
    expect(session.status).toBe("active");

    const firstEvent = await checkpointMemorySession(session.id, "Initial user message", {
      role: "user",
      kind: "message",
      turnIndex: 1,
      tokenCount: 18,
    });
    expect(firstEvent.session_id).toBe(session.id);
    expect(firstEvent.kind).toBe("message");

    const checkpoint = await checkpointMemorySession(session.id, "Checkpointed key details");
    expect(checkpoint.kind).toBe("checkpoint");

    const events = await listMemorySessionEvents(session.id, { limit: 10, meaningfulOnly: true });
    expect(events.length).toBe(2);
    expect(new Set(events.map((event) => event.id))).toEqual(new Set([firstEvent.id, checkpoint.id]));

    const snapshot = await createMemorySessionSnapshot(session.id, {
      sourceTrigger: "manual",
      transcriptMd: "# Snapshot\n\n- user: Initial message\n- assistant: Checkpointed key details",
      messageCount: events.length,
    });
    expect(snapshot.session_id).toBe(session.id);
    expect(snapshot.message_count).toBe(2);

    const summary = await getMemorySessionStatus(session.id);
    expect(summary).not.toBeNull();
    expect(summary?.eventCount).toBe(2);
    expect(summary?.checkpointCount).toBe(1);
    expect(summary?.snapshotCount).toBe(1);
    expect(summary?.latestCheckpointId).toBe(checkpoint.id);

    const closed = await endMemorySession(session.id, { status: "closed" });
    expect(closed?.status).toBe("closed");
    expect(closed?.ended_at).toBeTruthy();

    await expect(checkpointMemorySession(session.id, "Should fail after close")).rejects.toThrow(
      `Cannot checkpoint session ${session.id} because it is closed`
    );
  });

  it("should resolve latest active session for project scope", async () => {
    await startMemorySession({ global: true, title: "Global session A" });
    const projectSession = await startMemorySession({
      projectId: "github.com/acme/memories",
      title: "Project session",
    });
    await checkpointMemorySession(projectSession.id, "project activity", {
      kind: "event",
      role: "assistant",
    });

    const latest = await getLatestActiveMemorySession({
      projectId: "github.com/acme/memories",
      includeGlobal: true,
    });

    expect(latest).not.toBeNull();
    expect(latest?.id).toBe(projectSession.id);
    expect(latest?.scope).toBe("project");
  });

  it("should create write-ahead checkpoints and compaction event logs", async () => {
    const session = await startMemorySession({
      global: true,
      title: "Compaction test session",
      client: "vitest",
    });
    const rule = await addMemory("Always checkpoint before compaction", {
      type: "rule",
      global: true,
    });
    const memory = await addMemory("Context payload that may exceed token budget", {
      type: "note",
      global: true,
    });

    const estimate = estimateContextTokenCount({
      rules: [rule],
      memories: [memory],
    });
    expect(estimate).toBeGreaterThan(0);

    const result = await writeAheadCompactionCheckpoint(session.id, {
      query: "compaction flow",
      rules: [rule],
      memories: [memory],
      triggerType: "count",
      reason: "Estimated tokens exceed budget",
      tokenCountBefore: estimate,
      turnCountBefore: 19,
    });

    expect(result.tokenCountBefore).toBe(estimate);
    expect(result.checkpointEvent.kind).toBe("checkpoint");
    expect(result.compactionEvent.trigger_type).toBe("count");
    expect(result.compactionEvent.checkpoint_memory_id).toBe(result.checkpointEvent.id);
    expect(result.compactionEvent.turn_count_before).toBe(19);

    const summary = await getMemorySessionStatus(session.id);
    expect(summary).not.toBeNull();
    expect(summary?.checkpointCount).toBeGreaterThan(0);
  });

  it("should compact inactive sessions with the inactivity worker", async () => {
    const session = await startMemorySession({
      global: true,
      title: "Inactive session",
      client: "vitest",
    });
    await checkpointMemorySession(session.id, "Old activity", {
      role: "assistant",
      kind: "message",
    });

    const db = await getDb();
    await db.execute({
      sql: "UPDATE memory_sessions SET last_activity_at = ? WHERE id = ?",
      args: ["2020-01-01T00:00:00.000Z", session.id],
    });

    const result = await runInactivityCompactionWorker({
      inactivityMinutes: 30,
      limit: 10,
      eventWindow: 5,
    });

    expect(result.scanned).toBeGreaterThan(0);
    expect(result.compacted).toBeGreaterThan(0);
    expect(result.failures).toEqual([]);

    const updated = await getMemorySessionStatus(session.id);
    expect(updated?.session.status).toBe("compacted");
    expect(updated?.checkpointCount).toBeGreaterThan(0);
  });
});
