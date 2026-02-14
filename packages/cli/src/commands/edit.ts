import { Command } from "commander";
import chalk from "chalk";
import { execFileSync } from "node:child_process";
import * as ui from "../lib/ui.js";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { select } from "@inquirer/prompts";
import { listMemories, updateMemory, isMemoryType, MEMORY_TYPES, type Memory, type MemoryType } from "../lib/memory.js";
import { getDb } from "../lib/db.js";
import { getProjectId } from "../lib/git.js";

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

async function pickMemory(): Promise<string> {
  const projectId = getProjectId() ?? undefined;
  const memories = await listMemories({ limit: 100, projectId });

  if (memories.length === 0) {
    console.error(chalk.dim("No memories found."));
    process.exit(0);
  }

  const id = await select({
    message: "Select a memory to edit",
    choices: memories.map((m) => ({
      name: `${chalk.dim(m.type.padEnd(9))} ${truncate(m.content, 60)} ${chalk.dim(m.id)}`,
      value: m.id,
    })),
  });

  return id;
}

export const editCommand = new Command("edit")
  .description("Edit an existing memory")
  .argument("[id]", "Memory ID to edit (interactive picker if omitted)")
  .option("-c, --content <content>", "New content (skips editor)")
  .option("-t, --tags <tags>", "New comma-separated tags")
  .option("--type <type>", "New memory type: rule, decision, fact, note, skill")
  .option("--paths <globs>", "New comma-separated glob patterns for path-scoped rules")
  .option("--category <name>", "New grouping key for organizing memories")
  .action(async (id: string | undefined, opts: { content?: string; tags?: string; type?: string; paths?: string; category?: string }) => {
    try {
      // Interactive picker if no ID provided
      if (!id) {
        if (!process.stdin.isTTY) {
          ui.error("Memory ID required in non-interactive mode");
          process.exit(1);
        }
        id = await pickMemory();
      }

      // Fetch existing memory
      const db = await getDb();
      const result = await db.execute({
        sql: `SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`,
        args: [id],
      });

      if (result.rows.length === 0) {
        ui.error(`Memory ${chalk.dim(id)} not found`);
        process.exit(1);
      }

      const memory = result.rows[0] as unknown as {
        id: string;
        content: string;
        tags: string | null;
        type: MemoryType;
      };

      // Validate type if provided
      if (opts.type && !isMemoryType(opts.type)) {
        ui.error(`Invalid type "${opts.type}". Valid: ${MEMORY_TYPES.join(", ")}`);
        process.exit(1);
      }

      let newContent = opts.content;

      // If no flags provided, open $EDITOR
      if (newContent === undefined && opts.tags === undefined && opts.type === undefined && opts.paths === undefined && opts.category === undefined) {
        const editor = process.env.EDITOR || process.env.VISUAL || "vi";
        const tmpFile = join(tmpdir(), `memories-edit-${nanoid(6)}.md`);

        writeFileSync(tmpFile, memory.content, "utf-8");

        try {
          execFileSync(editor, [tmpFile], { stdio: "inherit" });
          newContent = readFileSync(tmpFile, "utf-8").trimEnd();
        } finally {
          try { unlinkSync(tmpFile); } catch {}
        }

        if (newContent === memory.content) {
          console.log(chalk.dim("No changes made."));
          return;
        }
      }

      // Build updates
      const updates: { content?: string; tags?: string[]; type?: MemoryType; paths?: string[]; category?: string | null } = {};
      if (newContent !== undefined) updates.content = newContent;
      if (opts.tags !== undefined) updates.tags = opts.tags.split(",").map((s) => s.trim()).filter(Boolean);
      if (opts.type !== undefined && isMemoryType(opts.type)) updates.type = opts.type;
      if (opts.paths !== undefined) updates.paths = opts.paths.split(",").map((s) => s.trim()).filter(Boolean);
      if (opts.category !== undefined) updates.category = opts.category || null;

      const updated = await updateMemory(id, updates);

      if (!updated) {
        ui.error(`Failed to update memory ${chalk.dim(id)}`);
        process.exit(1);
      }

      const changes: string[] = [];
      if (updates.content !== undefined) changes.push("content");
      if (updates.tags !== undefined) changes.push("tags");
      if (updates.type !== undefined) changes.push(`type→${updates.type}`);
      if (updates.paths !== undefined) changes.push("paths");
      if (updates.category !== undefined) changes.push("category");

      ui.success(`Updated ${chalk.dim(id)} (${changes.join(", ")})`);
    } catch (error) {
      if (error instanceof Error && error.name === "ExitPromptError") return;
      ui.error("Failed to edit memory: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
