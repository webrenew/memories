import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildApplyScopeFilter,
  resolveProjectScope,
  scanTarget,
  selectScopedFileMatch,
} from "./files-helpers.js";

describe("files-helpers scope resolution", () => {
  it("normalizes project scope ids", () => {
    expect(resolveProjectScope(" github.com/acme/repo ")).toBe("github.com/acme/repo");
    expect(resolveProjectScope("")).toBeNull();
    expect(resolveProjectScope(null)).toBeNull();
  });

  it("builds apply filter for project-only and mixed scopes", () => {
    expect(buildApplyScopeFilter({ project: true }, "github.com/acme/repo")).toEqual({
      clause: "scope = ?",
      args: ["github.com/acme/repo"],
    });

    expect(buildApplyScopeFilter({ global: true, project: true }, "github.com/acme/repo")).toEqual({
      clause: "(scope = 'global' OR scope = ?)",
      args: ["github.com/acme/repo"],
    });
  });

  it("returns safe filters and warnings when project scope is unavailable", () => {
    const projectOnly = buildApplyScopeFilter({ project: true }, null);
    expect(projectOnly.clause).toBe("scope = 'global' AND 1 = 0");
    expect(projectOnly.args).toEqual([]);
    expect(projectOnly.warning).toBeTruthy();

    const mixed = buildApplyScopeFilter({ global: true, project: true }, null);
    expect(mixed).toEqual({
      clause: "scope = 'global'",
      args: [],
      warning: "Project scope requested, but no git project id was detected. Applying global files only.",
    });
  });

  it("detects ambiguous path matches and resolves explicit scope selection", () => {
    const rows = [
      { scope: "global", value: "g" },
      { scope: "github.com/acme/repo", value: "p" },
    ];

    const ambiguous = selectScopedFileMatch(rows);
    expect(ambiguous.ambiguous).toBe(true);
    expect(ambiguous.match).toBeNull();
    expect(ambiguous.availableScopes).toEqual(["github.com/acme/repo", "global"]);

    const scoped = selectScopedFileMatch(rows, "github.com/acme/repo");
    expect(scoped.ambiguous).toBe(false);
    expect(scoped.match).toEqual({ scope: "github.com/acme/repo", value: "p" });
  });
});

describe("files-helpers scanTarget", () => {
  it("returns normalized synced paths for discovered files", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "memories-files-scan-"));
    const targetDir = join(baseDir, ".agents", "commands");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "review.md"), "# review");

    const files = await scanTarget(baseDir, { dir: ".agents/commands", pattern: /\.md$/ });
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(".agents/commands/review.md");
  });

  it("scans nested OpenClaw memory files recursively", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "memories-files-openclaw-scan-"));
    const dailyDir = join(baseDir, ".openclaw", "workspace", "memory", "daily");
    const snapshotDir = join(baseDir, ".openclaw", "workspace", "memory", "snapshots", "2026-02-26");
    mkdirSync(dailyDir, { recursive: true });
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(join(dailyDir, "2026-02-26.md"), "# daily");
    writeFileSync(join(snapshotDir, "phase-4-1.md"), "# snapshot");

    const files = await scanTarget(baseDir, {
      dir: ".openclaw/workspace/memory",
      pattern: /\.md$/,
      recurse: true,
    });
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual([
      ".openclaw/workspace/memory/daily/2026-02-26.md",
      ".openclaw/workspace/memory/snapshots/2026-02-26/phase-4-1.md",
    ]);
  });
});
