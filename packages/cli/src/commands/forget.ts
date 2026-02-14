import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import * as ui from "../lib/ui.js";
import {
  forgetMemory,
  findMemoriesToForget,
  bulkForgetByIds,
  isMemoryType,
  MEMORY_TYPES,
  type MemoryType,
  type BulkForgetFilter,
} from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";

const TYPE_ICONS: Record<MemoryType, string> = {
  rule: "📌",
  decision: "💡",
  fact: "📋",
  note: "📝",
  skill: "🔧",
};

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(message);
  rl.close();
  return answer.toLowerCase().startsWith("y");
}

export const forgetCommand = new Command("forget")
  .description("Soft-delete memories by ID or bulk filter")
  .argument("[id]", "Memory ID to forget (omit for bulk operations)")
  .option("--type <type>", "Forget all memories of this type: rule, decision, fact, note")
  .option("--tag <tag>", "Forget all memories with this tag")
  .option("--older-than <days>", "Forget memories older than N days")
  .option("--pattern <pattern>", "Forget memories matching pattern (use * as wildcard)")
  .option("--all", "Forget ALL memories (requires --force or confirmation)")
  .option("--project-only", "Only forget project-scoped memories")
  .option("--dry-run", "Preview what would be deleted without deleting")
  .option("--force", "Skip confirmation prompt")
  .action(async (id: string | undefined, opts: {
    type?: string;
    tag?: string;
    olderThan?: string;
    pattern?: string;
    all?: boolean;
    projectOnly?: boolean;
    dryRun?: boolean;
    force?: boolean;
  }) => {
    try {
      // Single ID delete (original behavior)
      if (id) {
        const deleted = await forgetMemory(id);
        if (deleted) {
          ui.success(`Forgot memory ${chalk.dim(id)}`);
        } else {
          ui.error(`Memory ${id} not found or already forgotten.`);
          process.exit(1);
        }
        return;
      }

      // Bulk delete — need at least one filter
      const hasBulkFilter = opts.type || opts.tag || opts.olderThan || opts.pattern || opts.all;
      if (!hasBulkFilter) {
        ui.error("Provide a memory ID or a bulk filter (--type, --tag, --older-than, --pattern, --all)");
        process.exit(1);
      }

      // Reject --all combined with other filters (ambiguous intent)
      if (opts.all && (opts.type || opts.tag || opts.olderThan || opts.pattern)) {
        ui.error("--all cannot be combined with other filters. Use --all alone to delete everything.");
        process.exit(1);
      }

      // Validate type
      if (opts.type && !isMemoryType(opts.type)) {
        ui.error(`Invalid type "${opts.type}". Valid: ${MEMORY_TYPES.join(", ")}`);
        process.exit(1);
      }

      // Validate older-than
      if (opts.olderThan && (isNaN(parseInt(opts.olderThan, 10)) || parseInt(opts.olderThan, 10) <= 0)) {
        ui.error("--older-than must be a positive number of days");
        process.exit(1);
      }

      // Build filter
      const filter: BulkForgetFilter = {
        types: opts.type && isMemoryType(opts.type) ? [opts.type] : undefined,
        tags: opts.tag ? [opts.tag] : undefined,
        olderThanDays: opts.olderThan ? parseInt(opts.olderThan, 10) : undefined,
        pattern: opts.pattern,
        all: opts.all,
        projectId: opts.projectOnly ? (getProjectId() ?? undefined) : undefined,
      };

      // Preview
      const matches = await findMemoriesToForget(filter);

      if (matches.length === 0) {
        console.log(chalk.dim("No memories match the filter."));
        return;
      }

      // Show what will be deleted
      console.log(chalk.bold(`${matches.length} memories will be forgotten:\n`));
      for (const m of matches.slice(0, 30)) {
        const icon = TYPE_ICONS[m.type] || "📝";
        const scope = m.scope === "global" ? chalk.dim("G") : chalk.dim("P");
        console.log(`  ${icon} ${scope} ${chalk.dim(m.id)}  ${m.content}`);
      }
      if (matches.length > 30) {
        console.log(chalk.dim(`  ... and ${matches.length - 30} more`));
      }
      console.log("");

      if (opts.dryRun) {
        console.log(chalk.yellow("Dry run") + " — no memories were deleted.");
        return;
      }

      // Confirm unless --force
      if (!opts.force) {
        const proceed = await confirm(
          chalk.yellow(`Forget ${matches.length} memories? This is a soft-delete. [y/N] `)
        );
        if (!proceed) {
          console.log("Cancelled.");
          return;
        }
      }

      const ids = matches.map((m) => m.id);
      const count = await bulkForgetByIds(ids);
      ui.success(`Forgot ${count} memories.`);
    } catch (error) {
      ui.error("Failed to forget: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
