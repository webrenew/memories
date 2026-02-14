import { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../lib/db.js";
import * as ui from "../lib/ui.js";
import { getProjectId } from "../lib/git.js";
import { isMemoryType, MEMORY_TYPES, type MemoryType } from "../lib/memory.js";

interface TagFilters {
  type?: string;
  scope?: string;
}

/**
 * Build WHERE clause for filtering memories to tag/untag.
 */
function buildWhere(filters: TagFilters): { where: string; args: (string | number)[] } {
  const conditions: string[] = ["deleted_at IS NULL"];
  const args: (string | number)[] = [];
  const projectId = getProjectId();

  if (filters.type) {
    if (!isMemoryType(filters.type)) {
      throw new Error(`Invalid type "${filters.type}". Valid: ${MEMORY_TYPES.join(", ")}`);
    }
    conditions.push("type = ?");
    args.push(filters.type);
  }

  if (filters.scope === "global") {
    conditions.push("scope = 'global'");
  } else if (filters.scope === "project") {
    if (!projectId) throw new Error("Not in a git repo — cannot filter by project scope.");
    conditions.push("scope = 'project' AND project_id = ?");
    args.push(projectId);
  }

  return { where: conditions.join(" AND "), args };
}

/**
 * Parse existing comma-separated tags into a Set.
 */
function parseTags(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").map((t) => t.trim()).filter(Boolean));
}

export const tagCommand = new Command("tag")
  .description("Bulk tag/untag operations on memories");

// ── tag add ──────────────────────────────────────────────────────────

tagCommand.addCommand(
  new Command("add")
    .description("Add a tag to matching memories")
    .argument("<tag>", "Tag to add")
    .option("--type <type>", "Filter by memory type (rule, decision, fact, note)")
    .option("--scope <scope>", "Filter by scope (global, project)")
    .option("--dry-run", "Preview without modifying")
    .action(async (tag: string, opts: TagFilters & { dryRun?: boolean }) => {
      try {
        const db = await getDb();
        const { where, args } = buildWhere(opts);

        const result = await db.execute({ sql: `SELECT id, tags FROM memories WHERE ${where}`, args });

        let updated = 0;
        let skipped = 0;

        for (const row of result.rows) {
          const existing = parseTags(row.tags as string | null);
          if (existing.has(tag)) {
            skipped++;
            continue;
          }

          existing.add(tag);
          const newTags = [...existing].join(",");

          if (!opts.dryRun) {
            await db.execute({
              sql: "UPDATE memories SET tags = ?, updated_at = datetime('now') WHERE id = ?",
              args: [newTags, row.id as string],
            });
          }
          updated++;
        }

        if (opts.dryRun) {
          console.log(chalk.dim(`Dry run — would tag ${updated} memories with "${tag}" (${skipped} already tagged)`));
        } else {
          ui.success(`Tagged ${updated} memories with "${tag}"` + (skipped > 0 ? chalk.dim(` (${skipped} already tagged)`) : ""));
        }
      } catch (error) {
        ui.error(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

// ── tag remove ───────────────────────────────────────────────────────

tagCommand.addCommand(
  new Command("remove")
    .description("Remove a tag from matching memories")
    .argument("<tag>", "Tag to remove")
    .option("--type <type>", "Filter by memory type (rule, decision, fact, note)")
    .option("--scope <scope>", "Filter by scope (global, project)")
    .option("--dry-run", "Preview without modifying")
    .action(async (tag: string, opts: TagFilters & { dryRun?: boolean }) => {
      try {
        const db = await getDb();
        const { where, args } = buildWhere(opts);

        // Only look at memories that actually have this tag
        const result = await db.execute({
          sql: `SELECT id, tags FROM memories WHERE ${where} AND tags LIKE ?`,
          args: [...args, `%${tag}%`],
        });

        let updated = 0;

        for (const row of result.rows) {
          const existing = parseTags(row.tags as string | null);
          if (!existing.has(tag)) continue;

          existing.delete(tag);
          const newTags = existing.size > 0 ? [...existing].join(",") : null;

          if (!opts.dryRun) {
            await db.execute({
              sql: "UPDATE memories SET tags = ?, updated_at = datetime('now') WHERE id = ?",
              args: [newTags, row.id as string],
            });
          }
          updated++;
        }

        if (opts.dryRun) {
          console.log(chalk.dim(`Dry run — would remove "${tag}" from ${updated} memories`));
        } else {
          ui.success(`Removed "${tag}" from ${updated} memories`);
        }
      } catch (error) {
        ui.error(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

// ── tag list ─────────────────────────────────────────────────────────

tagCommand.addCommand(
  new Command("list")
    .description("List all tags in use with counts")
    .option("--type <type>", "Filter by memory type")
    .option("--scope <scope>", "Filter by scope (global, project)")
    .action(async (opts: TagFilters) => {
      try {
        const db = await getDb();
        const { where, args } = buildWhere(opts);

        const result = await db.execute({
          sql: `SELECT tags FROM memories WHERE ${where} AND tags IS NOT NULL AND tags != ''`,
          args,
        });

        const counts = new Map<string, number>();
        for (const row of result.rows) {
          for (const tag of parseTags(row.tags as string)) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
          }
        }

        if (counts.size === 0) {
          console.log(chalk.dim("No tags found."));
          return;
        }

        // Sort by count descending
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        for (const [tag, count] of sorted) {
          console.log(`  ${chalk.bold(tag)} ${chalk.dim(`(${count})`)}`);
        }
      } catch (error) {
        ui.error(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);
