import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  DEFAULT_OPENCLAW_WORKSPACE_RELATIVE_PATH,
  OPENCLAW_CONFIG_RELATIVE_PATH,
  appendOpenClawDailyLog,
  buildOpenClawPathContract,
  extractOpenClawWorkspaceSetting,
  formatOpenClawBootstrapContext,
  isOpenClawFileModeEnabled,
  normalizeOpenClawDateKey,
  normalizeOpenClawSnapshotSlug,
  readOpenClawBootstrapContext,
  resolveOpenClawMemoryBucket,
  resolveOpenClawWorkspaceDirectory,
  routeOpenClawMemoryFile,
  writeOpenClawSnapshot,
} from "./openclaw-memory.js";

describe("openclaw-memory", () => {
  it("extracts workspace setting from supported openclaw.json paths", () => {
    expect(extractOpenClawWorkspaceSetting({ agent: { workspace: "~/custom/workspace" } })).toBe(
      "~/custom/workspace",
    );
    expect(
      extractOpenClawWorkspaceSetting({
        agents: { defaults: { workspace: "/tmp/openclaw-workspace" } },
      }),
    ).toBe("/tmp/openclaw-workspace");
    expect(extractOpenClawWorkspaceSetting({ paths: { workspacePath: "relative/workspace" } })).toBe(
      "relative/workspace",
    );
    expect(extractOpenClawWorkspaceSetting({})).toBeNull();
  });

  it("resolves workspace path with override > env > config > default precedence", async () => {
    const home = "/Users/tester";

    const overridden = await resolveOpenClawWorkspaceDirectory({
      homeDir: home,
      workspaceDir: "~/override/ws",
      env: { MEMORIES_OPENCLAW_WORKSPACE_DIR: "~/env/ws" },
      existsFn: () => true,
      readFileFn: async () => JSON.stringify({ agent: { workspace: "~/config/ws" } }),
    });
    expect(overridden.workspaceDir).toBe("/Users/tester/override/ws");
    expect(overridden.source).toBe("override");

    const fromEnv = await resolveOpenClawWorkspaceDirectory({
      homeDir: home,
      env: { OPENCLAW_WORKSPACE_DIR: "~/env/ws" },
      existsFn: () => false,
    });
    expect(fromEnv.workspaceDir).toBe("/Users/tester/env/ws");
    expect(fromEnv.source).toBe("env");

    const fromConfig = await resolveOpenClawWorkspaceDirectory({
      homeDir: home,
      env: {},
      existsFn: () => true,
      readFileFn: async () => JSON.stringify({ agents: { defaults: { workspace: "alt-workspace" } } }),
    });
    expect(fromConfig.workspaceDir).toBe("/Users/tester/.openclaw/alt-workspace");
    expect(fromConfig.configPath).toBe("/Users/tester/.openclaw/openclaw.json");
    expect(fromConfig.source).toBe("config");

    const fallback = await resolveOpenClawWorkspaceDirectory({
      homeDir: home,
      env: {},
      existsFn: () => false,
    });
    expect(fallback.workspaceDir).toBe(join(home, DEFAULT_OPENCLAW_WORKSPACE_RELATIVE_PATH));
    expect(fallback.configPath).toBe(join(home, OPENCLAW_CONFIG_RELATIVE_PATH));
    expect(fallback.source).toBe("default");
  });

  it("builds deterministic openclaw path contract", () => {
    const contract = buildOpenClawPathContract("/Users/tester/.openclaw/workspace");
    expect(contract.semanticMemoryFile).toBe("/Users/tester/.openclaw/workspace/memory.md");
    expect(contract.semanticMemoryCandidates).toEqual([
      "/Users/tester/.openclaw/workspace/memory.md",
      "/Users/tester/.openclaw/workspace/MEMORY.md",
    ]);
    expect(contract.dailyDir).toBe("/Users/tester/.openclaw/workspace/memory/daily");
    expect(contract.snapshotsDir).toBe("/Users/tester/.openclaw/workspace/memory/snapshots");
  });

  it("routes semantic, daily, and snapshot files deterministically", () => {
    const contract = buildOpenClawPathContract("/Users/tester/.openclaw/workspace");

    const semantic = routeOpenClawMemoryFile({
      contract,
      kind: "semantic",
    });
    expect(semantic.absolutePath).toBe("/Users/tester/.openclaw/workspace/memory.md");
    expect(semantic.workspaceRelativePath).toBe("memory.md");
    expect(semantic.appendOnly).toBe(false);

    const daily = routeOpenClawMemoryFile({
      contract,
      kind: "episodic_daily",
      date: "2026-02-26T13:00:00.000Z",
    });
    expect(daily.absolutePath).toBe("/Users/tester/.openclaw/workspace/memory/daily/2026-02-26.md");
    expect(daily.workspaceRelativePath).toBe("memory/daily/2026-02-26.md");
    expect(daily.appendOnly).toBe(true);

    const snapshot = routeOpenClawMemoryFile({
      contract,
      kind: "snapshot",
      date: "2026-02-26",
      slug: "Phase 4.1 / reset snapshot",
    });
    expect(snapshot.absolutePath).toBe(
      "/Users/tester/.openclaw/workspace/memory/snapshots/2026-02-26/phase-4-1-reset-snapshot.md",
    );
    expect(snapshot.workspaceRelativePath).toBe(
      "memory/snapshots/2026-02-26/phase-4-1-reset-snapshot.md",
    );
    expect(snapshot.appendOnly).toBe(false);
  });

  it("normalizes date and slug values", () => {
    expect(normalizeOpenClawDateKey("2026-02-26T08:04:00.000Z")).toBe("2026-02-26");
    expect(() => normalizeOpenClawDateKey("not-a-date")).toThrow("Invalid date for OpenClaw memory path");

    expect(normalizeOpenClawSnapshotSlug("  Snapshot: Keep THIS!  ")).toBe("snapshot-keep-this");
    expect(normalizeOpenClawSnapshotSlug("   ")).toBe("snapshot");
  });

  it("routes memory buckets from intent hints", () => {
    expect(resolveOpenClawMemoryBucket({ memoryType: "rule" })).toBe("semantic");
    expect(resolveOpenClawMemoryBucket({ memoryLayer: "rule" })).toBe("semantic");
    expect(resolveOpenClawMemoryBucket({ sourceTrigger: "reset" })).toBe("snapshot");
    expect(resolveOpenClawMemoryBucket({ bucket: "semantic" })).toBe("semantic");
    expect(resolveOpenClawMemoryBucket({})).toBe("episodic");
  });

  it("parses the openclaw file mode feature flag", () => {
    expect(isOpenClawFileModeEnabled({ MEMORY_OPENCLAW_FILE_MODE_ENABLED: "1" })).toBe(true);
    expect(isOpenClawFileModeEnabled({ MEMORY_OPENCLAW_FILE_MODE_ENABLED: "true" })).toBe(true);
    expect(isOpenClawFileModeEnabled({ MEMORY_OPENCLAW_FILE_MODE_ENABLED: "false" })).toBe(false);
    expect(isOpenClawFileModeEnabled({})).toBe(false);
  });

  it("reads and formats bootstrap context from semantic + daily files", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "memories-openclaw-bootstrap-"));
    mkdirSync(join(workspaceDir, "memory", "daily"), { recursive: true });

    const today = normalizeOpenClawDateKey("2026-02-26T15:00:00.000Z");
    const yesterday = normalizeOpenClawDateKey("2026-02-25T15:00:00.000Z");
    writeFileSync(join(workspaceDir, "memory.md"), "Always include acceptance criteria.");
    writeFileSync(join(workspaceDir, "memory", "daily", `${today}.md`), "## Today\n- Ship phase 4.2");
    writeFileSync(join(workspaceDir, "memory", "daily", `${yesterday}.md`), "## Yesterday\n- Merged phase 4.1");

    const bootstrap = await readOpenClawBootstrapContext({
      workspaceDir,
      now: "2026-02-26T15:00:00.000Z",
    });

    expect(bootstrap.semanticFile).toBe(join(workspaceDir, "memory.md"));
    expect(bootstrap.semanticContent).toContain("Always include acceptance criteria.");
    expect(bootstrap.dailyLogs.map((log) => log.dateKey)).toEqual([today, yesterday]);

    const formatted = formatOpenClawBootstrapContext(bootstrap);
    expect(formatted).toContain("OpenClaw bootstrap context.");
    expect(formatted).toContain("Semantic memory:");
    expect(formatted).toContain("Daily log (2026-02-26)");
    expect(formatted).toContain("Daily log (2026-02-25)");
  });

  it("appends daily log entries and writes snapshots", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "memories-openclaw-write-"));

    const dailyResult = await appendOpenClawDailyLog("Compaction checkpoint payload", {
      workspaceDir,
      date: "2026-02-26T01:00:00.000Z",
      heading: "## Compaction checkpoint",
    });
    expect(dailyResult.route.absolutePath).toBe(
      join(workspaceDir, "memory", "daily", "2026-02-26.md"),
    );
    const dailyContent = readFileSync(dailyResult.route.absolutePath, "utf-8");
    expect(dailyContent).toContain("## Compaction checkpoint");
    expect(dailyContent).toContain("Compaction checkpoint payload");

    const snapshotResult = await writeOpenClawSnapshot("# Session Snapshot\n\n- user: hello", {
      workspaceDir,
      date: "2026-02-26",
      slug: "reset-after-compaction",
    });
    expect(snapshotResult.route.absolutePath).toBe(
      join(workspaceDir, "memory", "snapshots", "2026-02-26", "reset-after-compaction.md"),
    );
    const snapshotContent = readFileSync(snapshotResult.route.absolutePath, "utf-8");
    expect(snapshotContent).toContain("# Session Snapshot");
    expect(snapshotContent).toContain("- user: hello");
  });
});
