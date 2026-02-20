import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Must be set before any db import
process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-doctor-test-"));

import { addMemory, forgetMemory } from "../lib/memory.js";
import { getDb, repairFtsSchema } from "../lib/db.js";
import { checkWritePath, runDoctorChecks } from "./doctor.js";

describe("doctor checks", () => {
  beforeAll(async () => {
    await getDb();
  });

  it("should detect database connection", async () => {
    const db = await getDb();
    const result = await db.execute("SELECT 1 as ok");
    expect(Number(result.rows[0]?.ok)).toBe(1);
  });

  it("should pass integrity check on fresh DB", async () => {
    const db = await getDb();
    const result = await db.execute("PRAGMA integrity_check");
    expect(String(result.rows[0]?.integrity_check)).toBe("ok");
  });

  it("should add FTS entries when adding memories", async () => {
    const db = await getDb();
    const before = await db.execute("SELECT COUNT(*) as count FROM memories_fts");
    const beforeCount = Number(before.rows[0]?.count);

    await addMemory("doctor test rule", { global: true, type: "rule" });
    await addMemory("doctor test fact", { global: true, type: "fact" });

    const after = await db.execute("SELECT COUNT(*) as count FROM memories_fts");
    const afterCount = Number(after.rows[0]?.count);

    expect(afterCount).toBe(beforeCount + 2);
  });

  it("should count soft-deleted records", async () => {
    const memory = await addMemory("will be deleted", { global: true });
    await forgetMemory(memory.id);

    const db = await getDb();
    const result = await db.execute(
      "SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NOT NULL",
    );
    expect(Number(result.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("should pass write path probe", async () => {
    const db = await getDb();
    const result = await checkWritePath(db);
    expect(result.ok).toBe(true);
  });

  it("should repair missing FTS triggers", async () => {
    const db = await getDb();
    await db.execute("DROP TRIGGER IF EXISTS memories_au");

    const before = await checkWritePath(db);
    expect(before.ok).toBe(false);
    expect(before.message).toContain("Missing FTS trigger");

    await repairFtsSchema(db);

    const after = await checkWritePath(db);
    expect(after.ok).toBe(true);
  });

  it("should produce stable doctor JSON report metadata", async () => {
    const report = await runDoctorChecks();
    expect(report.schemaVersion).toBe("1.1");
    expect(Array.isArray(report.nextSteps)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);

    for (const check of report.checks) {
      expect(check.id.length).toBeGreaterThan(0);
      expect(check.code.length).toBeGreaterThan(0);
      expect([
        "config",
        "database",
        "mcp",
        "cloud",
        "project",
        "data",
      ]).toContain(check.category);
      expect(["pass", "warn", "fail"]).toContain(check.status);
    }
  });

  it("should deduplicate next steps", async () => {
    const report = await runDoctorChecks();
    const unique = new Set(report.nextSteps);
    expect(unique.size).toBe(report.nextSteps.length);
  });

  it("should mark cloud integration healthy in explicit local-only mode", async () => {
    const report = await runDoctorChecks({ localOnly: true });
    const cloudCheck = report.checks.find((check) => check.id === "cloud_integration");
    expect(cloudCheck).toBeDefined();
    expect(cloudCheck?.status).toBe("pass");
    expect(cloudCheck?.message).toContain("Skipped cloud checks");
  });
});
