import { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import * as ui from "../lib/ui.js";
import { getDb } from "../lib/db.js";
import {
  addMemory,
  createMemorySessionSnapshot,
  getRules,
  isMemorySessionSnapshotTrigger,
  listMemorySessionEvents,
  MEMORY_SESSION_SNAPSHOT_TRIGGERS,
  type MemorySessionEvent,
} from "../lib/memory.js";
import {
  appendOpenClawDailyLog,
  buildOpenClawPathContract,
  formatOpenClawBootstrapContext,
  readOpenClawBootstrapContext,
  resolveOpenClawWorkspaceDirectory,
  writeOpenClawDailyLog,
  writeOpenClawSemanticMemory,
  writeOpenClawSnapshot,
} from "../lib/openclaw-memory.js";

type SyncDirection = "import" | "export" | "both";

interface ExportSummary {
  semanticRules: number;
  dailyLogs: number;
  snapshots: number;
}

interface ImportSummary {
  semanticRules: number;
  dailyLogs: number;
  snapshots: number;
  skippedDuplicates: number;
}

interface SyncSummary {
  direction: SyncDirection;
  workspaceDir: string;
  exported: ExportSummary;
  imported: ImportSummary;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeDirection(value: string | undefined): SyncDirection {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "both") return "both";
  if (normalized === "import" || normalized === "export") return normalized;
  throw new Error("direction must be one of: import, export, both");
}

function buildTranscriptFromEvents(sessionId: string, events: MemorySessionEvent[]): string {
  const body = events
    .map((event) => `### ${event.role} (${event.kind})\n${event.content}`)
    .join("\n\n");
  return `# Session Snapshot\n\nSession ID: ${sessionId}\n\n${body}`;
}

function extractSemanticRulesFromMarkdown(content: string): string[] {
  const seen = new Set<string>();
  const extracted: string[] = [];
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || trimmed.startsWith("<!--")) continue;
    const candidate = trimmed
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .trim();
    if (!candidate || candidate.length < 3) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    extracted.push(candidate);
  }
  return extracted;
}

async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  if (!existsSync(rootDir)) return [];

  const out: string[] = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        out.push(fullPath);
      }
    }
  }

  return out.sort();
}

async function memoryExistsByContent(content: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT id FROM memories WHERE deleted_at IS NULL AND content = ? LIMIT 1",
    args: [content],
  });
  return result.rows.length > 0;
}

async function exportDbToOpenClawFiles(workspaceDir: string): Promise<ExportSummary> {
  const now = new Date().toISOString();
  const rules = await getRules();
  const uniqueRules = [...new Set(rules.map((rule) => rule.content.trim()).filter(Boolean))].slice(0, 200);
  const semanticDoc = [
    "# Semantic Memory",
    "",
    `Generated: ${now}`,
    "",
    ...uniqueRules.map((rule) => `- ${rule}`),
  ].join("\n");
  await writeOpenClawSemanticMemory(semanticDoc, { workspaceDir });

  const db = await getDb();

  const eventRows = await db.execute({
    sql: `SELECT session_id, role, kind, content, created_at
          FROM memory_session_events
          WHERE is_meaningful = 1
          ORDER BY created_at ASC`,
  });

  const eventsByDate = new Map<string, Array<{ sessionId: string; role: string; kind: string; content: string; createdAt: string }>>();
  for (const row of eventRows.rows) {
    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    const dateKey = createdAt.slice(0, 10);
    if (!dateKey) continue;
    const bucket = eventsByDate.get(dateKey) ?? [];
    bucket.push({
      sessionId: typeof row.session_id === "string" ? row.session_id : "unknown",
      role: typeof row.role === "string" ? row.role : "assistant",
      kind: typeof row.kind === "string" ? row.kind : "event",
      content: typeof row.content === "string" ? row.content : "",
      createdAt,
    });
    eventsByDate.set(dateKey, bucket);
  }

  for (const [dateKey, rows] of eventsByDate) {
    const dailyDoc = [
      `# Daily Log ${dateKey}`,
      "",
      `Generated: ${now}`,
      "",
      ...rows.flatMap((row) => [
        `## ${row.createdAt} · ${row.role}/${row.kind} · ${row.sessionId}`,
        row.content.trim(),
        "",
      ]),
    ]
      .join("\n")
      .trim();
    if (!dailyDoc) continue;
    await writeOpenClawDailyLog(dailyDoc, {
      workspaceDir,
      date: dateKey,
    });
  }

  const snapshotRows = await db.execute({
    sql: `SELECT session_id, slug, source_trigger, transcript_md, created_at
          FROM memory_session_snapshots
          ORDER BY created_at ASC`,
  });

  for (const row of snapshotRows.rows) {
    const slug = typeof row.slug === "string" ? row.slug : "";
    const transcriptMd = typeof row.transcript_md === "string" ? row.transcript_md : "";
    if (!slug || !transcriptMd.trim()) continue;
    const createdAt = typeof row.created_at === "string" ? row.created_at : now;
    const sourceTrigger = typeof row.source_trigger === "string" ? row.source_trigger : "manual";
    const sessionId = typeof row.session_id === "string" ? row.session_id : "unknown";
    const snapshotDoc = [
      `<!-- session_id: ${sessionId}; source_trigger: ${sourceTrigger}; created_at: ${createdAt} -->`,
      transcriptMd.trim(),
    ].join("\n\n");

    await writeOpenClawSnapshot(snapshotDoc, {
      workspaceDir,
      date: createdAt,
      slug,
    });
  }

  return {
    semanticRules: uniqueRules.length,
    dailyLogs: eventsByDate.size,
    snapshots: snapshotRows.rows.length,
  };
}

async function importOpenClawFilesToDb(workspaceDir: string): Promise<ImportSummary> {
  const contract = buildOpenClawPathContract(workspaceDir);
  let semanticRules = 0;
  let dailyLogs = 0;
  let snapshots = 0;
  let skippedDuplicates = 0;

  let semanticSource = "";
  for (const candidate of contract.semanticMemoryCandidates) {
    if (!existsSync(candidate)) continue;
    semanticSource = await readFile(candidate, "utf-8");
    if (semanticSource.trim()) break;
  }

  if (semanticSource.trim()) {
    const rules = extractSemanticRulesFromMarkdown(semanticSource);
    for (const rule of rules) {
      if (await memoryExistsByContent(rule)) {
        skippedDuplicates += 1;
        continue;
      }
      await addMemory(rule, {
        global: true,
        type: "rule",
        tags: ["openclaw", "semantic", "import"],
        category: "openclaw-semantic",
      });
      semanticRules += 1;
    }
  }

  const dailyFiles = await collectMarkdownFiles(contract.dailyDir);
  for (const filePath of dailyFiles) {
    const content = (await readFile(filePath, "utf-8")).trim();
    if (!content) continue;
    const dateKey = basename(filePath, ".md");
    const memoryContent = `OpenClaw daily log (${dateKey})\n\n${content}`;
    if (await memoryExistsByContent(memoryContent)) {
      skippedDuplicates += 1;
      continue;
    }
    await addMemory(memoryContent, {
      global: true,
      type: "note",
      tags: ["openclaw", "episodic", "daily", "import"],
      category: "openclaw-daily",
      metadata: {
        sourcePath: filePath,
        dateKey,
      },
    });
    dailyLogs += 1;
  }

  const snapshotFiles = await collectMarkdownFiles(contract.snapshotsDir);
  for (const filePath of snapshotFiles) {
    const content = (await readFile(filePath, "utf-8")).trim();
    if (!content) continue;
    const memoryContent = `OpenClaw snapshot (${filePath})\n\n${content}`;
    if (await memoryExistsByContent(memoryContent)) {
      skippedDuplicates += 1;
      continue;
    }
    await addMemory(memoryContent, {
      global: true,
      type: "note",
      tags: ["openclaw", "episodic", "snapshot", "import"],
      category: "openclaw-snapshot",
      metadata: {
        sourcePath: filePath,
      },
    });
    snapshots += 1;
  }

  return {
    semanticRules,
    dailyLogs,
    snapshots,
    skippedDuplicates,
  };
}

export const openclawCommand = new Command("openclaw")
  .description("OpenClaw memory file workflows and sync");

const openclawMemoryCommand = new Command("memory")
  .description("Manage OpenClaw memory.md, daily logs, and snapshots");

openclawMemoryCommand.addCommand(
  new Command("bootstrap")
    .description("Read semantic memory and today/yesterday daily logs from OpenClaw workspace")
    .option("--workspace <path>", "Override OpenClaw workspace directory")
    .option("--json", "Output as JSON")
    .action(async (opts: { workspace?: string; json?: boolean }) => {
      try {
        const bootstrap = await readOpenClawBootstrapContext({ workspaceDir: opts.workspace });
        if (opts.json) {
          console.log(JSON.stringify(bootstrap, null, 2));
          return;
        }

        const formatted = formatOpenClawBootstrapContext(bootstrap);
        if (!formatted) {
          console.log(chalk.dim(`No OpenClaw bootstrap memory found under ${bootstrap.contract.workspaceDir}`));
          return;
        }
        console.log(formatted);
      } catch (error) {
        ui.error(`Failed to read bootstrap memory: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

openclawMemoryCommand.addCommand(
  new Command("flush")
    .description("Append recent meaningful session events into today's OpenClaw daily log")
    .argument("<session-id>", "Session ID")
    .option("-m, --messages <n>", "Number of events to include", "15")
    .option("--workspace <path>", "Override OpenClaw workspace directory")
    .option("--json", "Output as JSON")
    .action(async (sessionId: string, opts: { messages: string; workspace?: string; json?: boolean }) => {
      try {
        const limit = parsePositiveInt(opts.messages, "messages");
        const events = await listMemorySessionEvents(sessionId, {
          limit,
          meaningfulOnly: true,
        });
        if (events.length === 0) {
          ui.error(`No meaningful session events found for ${sessionId}`);
          process.exit(1);
        }

        const body = events
          .map((event) => `### ${event.created_at} · ${event.role}/${event.kind}\n${event.content}`)
          .join("\n\n");
        const flushed = await appendOpenClawDailyLog(body, {
          workspaceDir: opts.workspace,
          heading: `## Session flush · ${sessionId}`,
        });

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                sessionId,
                eventCount: events.length,
                path: flushed.route.absolutePath,
              },
              null,
              2,
            ),
          );
          return;
        }

        ui.success(
          `Flushed ${chalk.bold(String(events.length))} events to ${chalk.dim(flushed.route.absolutePath)}`,
        );
      } catch (error) {
        ui.error(`Failed to flush session events: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

openclawMemoryCommand.addCommand(
  new Command("snapshot")
    .description("Create a DB snapshot and write it to OpenClaw snapshot files")
    .argument("<session-id>", "Session ID")
    .option("--trigger <trigger>", `Source trigger: ${MEMORY_SESSION_SNAPSHOT_TRIGGERS.join(", ")}`, "manual")
    .option("--slug <slug>", "Optional snapshot slug override")
    .option("-m, --messages <n>", "Number of meaningful events to include", "15")
    .option("--workspace <path>", "Override OpenClaw workspace directory")
    .option("--json", "Output as JSON")
    .action(async (
      sessionId: string,
      opts: { trigger?: string; slug?: string; messages: string; workspace?: string; json?: boolean },
    ) => {
      try {
        const trigger = opts.trigger ?? "manual";
        if (!isMemorySessionSnapshotTrigger(trigger)) {
          ui.error(`Invalid trigger "${trigger}". Valid triggers: ${MEMORY_SESSION_SNAPSHOT_TRIGGERS.join(", ")}`);
          process.exit(1);
        }
        const limit = parsePositiveInt(opts.messages, "messages");
        const events = await listMemorySessionEvents(sessionId, {
          limit,
          meaningfulOnly: true,
        });
        if (events.length === 0) {
          ui.error(`No meaningful session events found for ${sessionId}`);
          process.exit(1);
        }

        const transcriptMd = buildTranscriptFromEvents(sessionId, events);
        const snapshot = await createMemorySessionSnapshot(sessionId, {
          sourceTrigger: trigger,
          slug: opts.slug,
          transcriptMd,
          messageCount: events.length,
        });

        const snapshotDoc = [
          `<!-- session_id: ${sessionId}; source_trigger: ${snapshot.source_trigger}; created_at: ${snapshot.created_at} -->`,
          snapshot.transcript_md,
        ].join("\n\n");
        const fileWrite = await writeOpenClawSnapshot(snapshotDoc, {
          workspaceDir: opts.workspace,
          date: snapshot.created_at,
          slug: snapshot.slug,
        });

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                snapshotId: snapshot.id,
                slug: snapshot.slug,
                dbCreatedAt: snapshot.created_at,
                filePath: fileWrite.route.absolutePath,
              },
              null,
              2,
            ),
          );
          return;
        }

        ui.success(
          `Snapshot ${chalk.dim(snapshot.id)} saved to ${chalk.dim(fileWrite.route.absolutePath)}`,
        );
      } catch (error) {
        ui.error(`Failed to create OpenClaw snapshot: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

openclawMemoryCommand.addCommand(
  new Command("sync")
    .description("Import/export OpenClaw memory files and local DB memory records")
    .option(
      "--direction <direction>",
      "Sync direction: import, export, or both (default)",
      "both",
    )
    .option("--workspace <path>", "Override OpenClaw workspace directory")
    .option("--json", "Output as JSON")
    .action(async (opts: { direction?: string; workspace?: string; json?: boolean }) => {
      try {
        const direction = normalizeDirection(opts.direction);
        const workspace = await resolveOpenClawWorkspaceDirectory({
          workspaceDir: opts.workspace,
        });

        const exported: ExportSummary = {
          semanticRules: 0,
          dailyLogs: 0,
          snapshots: 0,
        };
        const imported: ImportSummary = {
          semanticRules: 0,
          dailyLogs: 0,
          snapshots: 0,
          skippedDuplicates: 0,
        };

        if (direction === "export" || direction === "both") {
          const exportResult = await exportDbToOpenClawFiles(workspace.workspaceDir);
          Object.assign(exported, exportResult);
        }

        if (direction === "import" || direction === "both") {
          const importResult = await importOpenClawFilesToDb(workspace.workspaceDir);
          Object.assign(imported, importResult);
        }

        const summary: SyncSummary = {
          direction,
          workspaceDir: workspace.workspaceDir,
          exported,
          imported,
        };

        if (opts.json) {
          console.log(JSON.stringify(summary, null, 2));
          return;
        }

        ui.success(`OpenClaw memory sync complete (${direction})`);
        ui.dim(`Workspace: ${workspace.workspaceDir}`);
        if (direction === "export" || direction === "both") {
          console.log(
            `  Exported: rules=${chalk.bold(String(exported.semanticRules))}, daily=${chalk.bold(String(exported.dailyLogs))}, snapshots=${chalk.bold(String(exported.snapshots))}`,
          );
        }
        if (direction === "import" || direction === "both") {
          console.log(
            `  Imported: rules=${chalk.bold(String(imported.semanticRules))}, daily=${chalk.bold(String(imported.dailyLogs))}, snapshots=${chalk.bold(String(imported.snapshots))}, skipped=${chalk.bold(String(imported.skippedDuplicates))}`,
          );
        }
      } catch (error) {
        ui.error(`Failed to sync OpenClaw memory: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

openclawCommand.addCommand(openclawMemoryCommand);
