import { Command } from "commander";
import chalk from "chalk";
import * as ui from "../lib/ui.js";
import { getDb } from "../lib/db.js";
import { getProjectId } from "../lib/git.js";
import { forgetMemory, type MemoryType } from "../lib/memory.js";
import { createInterface } from "node:readline/promises";

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
  created_at: string;
  updated_at: string;
  days_old: number;
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
  .option("--json", "Output as JSON")
  .action(async (opts: { days: string; type?: string; json?: boolean }) => {
    try {
      const db = await getDb();
      const days = parseInt(opts.days, 10);
      const projectId = getProjectId() ?? undefined;

      if (isNaN(days) || days <= 0) {
        ui.error("--days must be a positive number");
        process.exit(1);
      }

      let sql = `
        SELECT id, content, type, scope, created_at, updated_at,
               CAST((julianday('now') - julianday(COALESCE(updated_at, created_at))) AS INTEGER) as days_old
        FROM memories 
        WHERE deleted_at IS NULL 
          AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) > ?
      `;
      const args: (string | number)[] = [days];

      if (opts.type) {
        sql += " AND type = ?";
        args.push(opts.type);
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
        console.log(`  ${icon} ${scope} ${chalk.dim(m.id)}  ${preview}  ${chalk.yellow(`${m.days_old}d`)}`);
      }

      if (stale.length > 30) {
        console.log(chalk.dim(`  ... and ${stale.length - 30} more`));
      }

      console.log("");
      console.log(`${stale.length} stale ${stale.length === 1 ? "memory" : "memories"} found`);
      console.log(chalk.dim("Run 'memories review' to clean up interactively"));
    } catch (error) {
      ui.error("Failed: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

export const reviewCommand = new Command("review")
  .description("Interactively review and clean up stale memories")
  .option("--days <n>", "Staleness threshold in days (default: 90)", "90")
  .action(async (opts: { days: string }) => {
    try {
      const db = await getDb();
      const days = parseInt(opts.days, 10);

      const result = await db.execute({
        sql: `
          SELECT id, content, type, scope, created_at, updated_at,
                 CAST((julianday('now') - julianday(COALESCE(updated_at, created_at))) AS INTEGER) as days_old
          FROM memories 
          WHERE deleted_at IS NULL 
            AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) > ?
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
        console.log(chalk.dim(`   Last updated: ${m.days_old} days ago`));
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
      ui.error("Review failed: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
