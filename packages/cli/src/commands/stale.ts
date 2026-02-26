import { Command } from "commander";
import chalk from "chalk";
import * as ui from "../lib/ui.js";
import { getDb } from "../lib/db.js";
import { forgetMemory, isMemoryType, MEMORY_TYPES, type MemoryType } from "../lib/memory.js";
import { createInterface } from "node:readline/promises";
import { parsePositiveIntegerOption } from "../lib/cli-options.js";

const TYPE_ICONS: Record<string, string> = {
  rule: "📌",
  decision: "💡",
  fact: "📋",
  note: "📝",
};

interface StaleMemory {
  id: string;
  content: string;
  type: MemoryType;
  scope: string;
  superseded_by: string | null;
  superseded_at: string | null;
  has_conflict: number;
  created_at: string;
  updated_at: string;
  days_old: number;
}

function buildSupersessionFilter(opts: {
  includeSuperseded?: boolean;
  supersededOnly?: boolean;
}): string {
  if (opts.supersededOnly) {
    return "m.superseded_at IS NOT NULL";
  }
  if (opts.includeSuperseded) {
    return "1 = 1";
  }
  return "m.superseded_at IS NULL";
}

async function ensureMemoryLinksTable(): Promise<void> {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'related',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_links_source ON memory_links(source_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_id)`);
}

async function prompt(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(message);
  rl.close();
  return answer.toLowerCase().trim();
}

export const staleCommand = new Command("stale")
  .description("Find memories that haven't been updated in a while")
  .option("--days <n>", "Staleness threshold in days (default: 90)", "90")
  .option("--type <type>", "Filter by memory type: rule, decision, fact, note")
  .option("--include-superseded", "Include already superseded memories")
  .option("--superseded-only", "Only show superseded memories")
  .option("--conflicts-only", "Only show memories with contradiction links")
  .option("--json", "Output as JSON")
  .action(async (opts: {
    days: string;
    type?: string;
    includeSuperseded?: boolean;
    supersededOnly?: boolean;
    conflictsOnly?: boolean;
    json?: boolean;
  }) => {
    try {
      const db = await getDb();
      await ensureMemoryLinksTable();
      const days = parsePositiveIntegerOption(opts.days, "--days");

      if (opts.type && !isMemoryType(opts.type)) {
        ui.error(`Invalid type "${opts.type}". Valid: ${MEMORY_TYPES.join(", ")}`);
        process.exit(1);
      }

      if (opts.includeSuperseded && opts.supersededOnly) {
        ui.error("Cannot combine --include-superseded with --superseded-only");
        process.exit(1);
      }

      let sql = `
        SELECT m.id, m.content, m.type, m.scope, m.superseded_by, m.superseded_at, m.created_at, m.updated_at,
               CAST((julianday('now') - julianday(COALESCE(m.updated_at, m.created_at))) AS INTEGER) as days_old,
               CASE
                 WHEN EXISTS (
                   SELECT 1 FROM memory_links l
                   WHERE (l.source_id = m.id OR l.target_id = m.id) AND l.link_type = 'contradicts'
                 ) THEN 1 ELSE 0
               END as has_conflict
        FROM memories m
        WHERE m.deleted_at IS NULL
          AND ${buildSupersessionFilter(opts)}
          AND (julianday('now') - julianday(COALESCE(m.updated_at, m.created_at))) > ?
      `;
      const args: (string | number)[] = [days];

      if (opts.type) {
        sql += " AND m.type = ?";
        args.push(opts.type);
      }

      if (opts.conflictsOnly) {
        sql += ` AND EXISTS (
          SELECT 1 FROM memory_links l
          WHERE (l.source_id = m.id OR l.target_id = m.id) AND l.link_type = 'contradicts'
        )`;
      }

      sql += " ORDER BY days_old DESC";

      const result = await db.execute({ sql, args });
      const stale = result.rows as unknown as StaleMemory[];

      if (opts.json) {
        console.log(JSON.stringify(stale, null, 2));
        return;
      }

      if (stale.length === 0) {
        ui.success(`No memories older than ${days} days.`);
        return;
      }

      console.log(chalk.bold(`⏰ Stale Memories (not updated in ${days}+ days)\n`));

      for (const m of stale.slice(0, 30)) {
        const icon = TYPE_ICONS[m.type] || "📝";
        const scope = m.scope === "global" ? chalk.dim("G") : chalk.dim("P");
        const preview = m.content.length > 50 ? m.content.slice(0, 47) + "..." : m.content;
        const superseded = m.superseded_at ? chalk.magenta("superseded") : "";
        const conflict = m.has_conflict ? chalk.red("conflict") : "";
        const status = [superseded, conflict].filter(Boolean).join(" ");
        console.log(`  ${icon} ${scope} ${chalk.dim(m.id)}  ${preview}  ${chalk.yellow(`${m.days_old}d`)} ${status}`.trimEnd());
      }

      if (stale.length > 30) {
        console.log(chalk.dim(`  ... and ${stale.length - 30} more`));
      }

      console.log("");
      console.log(`${stale.length} stale ${stale.length === 1 ? "memory" : "memories"} found`);
      console.log(chalk.dim("Run 'memories review' to clean up interactively"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message === "--days must be a positive integer") {
        ui.error("--days must be a positive number");
      } else {
        ui.error("Failed: " + message);
      }
      process.exit(1);
    }
  });

export const reviewCommand = new Command("review")
  .description("Interactively review and clean up stale memories")
  .option("--days <n>", "Staleness threshold in days (default: 90)", "90")
  .option("--include-superseded", "Include already superseded memories")
  .option("--superseded-only", "Only review superseded memories")
  .option("--conflicts-only", "Only review memories with contradiction links")
  .action(async (opts: {
    days: string;
    includeSuperseded?: boolean;
    supersededOnly?: boolean;
    conflictsOnly?: boolean;
  }) => {
    try {
      const db = await getDb();
      await ensureMemoryLinksTable();
      const days = parsePositiveIntegerOption(opts.days, "--days");

      if (opts.includeSuperseded && opts.supersededOnly) {
        ui.error("Cannot combine --include-superseded with --superseded-only");
        process.exit(1);
      }

      const result = await db.execute({
        sql: `
          SELECT m.id, m.content, m.type, m.scope, m.superseded_by, m.superseded_at, m.created_at, m.updated_at,
                 CAST((julianday('now') - julianday(COALESCE(m.updated_at, m.created_at))) AS INTEGER) as days_old,
                 CASE
                   WHEN EXISTS (
                     SELECT 1 FROM memory_links l
                     WHERE (l.source_id = m.id OR l.target_id = m.id) AND l.link_type = 'contradicts'
                   ) THEN 1 ELSE 0
                 END as has_conflict
          FROM memories m
          WHERE m.deleted_at IS NULL
            AND ${buildSupersessionFilter(opts)}
            AND (julianday('now') - julianday(COALESCE(m.updated_at, m.created_at))) > ?
            ${opts.conflictsOnly ? "AND EXISTS (SELECT 1 FROM memory_links l WHERE (l.source_id = m.id OR l.target_id = m.id) AND l.link_type = 'contradicts')" : ""}
          ORDER BY days_old DESC
        `,
        args: [days],
      });
      const stale = result.rows as unknown as StaleMemory[];

      if (stale.length === 0) {
        ui.success(`No stale memories to review.`);
        return;
      }

      console.log(chalk.bold(`\nReviewing ${stale.length} stale memories...\n`));

      let kept = 0, deleted = 0, skipped = 0;

      for (const m of stale) {
        const icon = TYPE_ICONS[m.type] || "📝";
        console.log(`${icon} ${chalk.bold(m.type.toUpperCase())} (${m.scope})`);
        console.log(`   "${m.content}"`);
        const status = [
          m.superseded_at ? "superseded" : null,
          m.has_conflict ? "conflict" : null,
        ].filter(Boolean).join(", ");
        console.log(chalk.dim(`   Last updated: ${m.days_old} days ago${status ? ` | ${status}` : ""}`));
        console.log("");

        const answer = await prompt("   [k]eep  [d]elete  [s]kip  [q]uit > ");

        if (answer === "q") {
          console.log("\nExiting review.");
          break;
        } else if (answer === "d") {
          await forgetMemory(m.id);
          console.log(chalk.green("   ✓ Deleted\n"));
          deleted++;
        } else if (answer === "k") {
          // Touch the updated_at to mark as reviewed
          await db.execute({
            sql: "UPDATE memories SET updated_at = datetime('now') WHERE id = ?",
            args: [m.id],
          });
          console.log(chalk.green("   ✓ Kept (marked as reviewed)\n"));
          kept++;
        } else {
          console.log(chalk.dim("   Skipped\n"));
          skipped++;
        }
      }

      console.log(chalk.bold("\nReview Summary:"));
      console.log(`  Kept: ${kept}, Deleted: ${deleted}, Skipped: ${skipped}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message === "--days must be a positive integer") {
        ui.error("--days must be a positive number");
      } else {
        ui.error("Review failed: " + message);
      }
      process.exit(1);
    }
  });
