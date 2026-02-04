import { Command } from "commander";
import chalk from "chalk";
import { getDb } from "../lib/db.js";
import { getMemoryById, updateMemory, type Memory } from "../lib/memory.js";

const TYPE_ICONS: Record<string, string> = {
  rule: "📌",
  decision: "💡",
  fact: "📋",
  note: "📝",
};

interface HistoryEntry {
  id: string;
  memory_id: string;
  content: string;
  tags: string | null;
  type: string;
  changed_at: string;
  change_type: "created" | "updated" | "deleted";
  version: number;
}

async function ensureHistoryTable(): Promise<void> {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_history (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      type TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      change_type TEXT NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_history_memory ON memory_history(memory_id)`);
}

export async function recordHistory(memory: Memory, changeType: "created" | "updated" | "deleted"): Promise<void> {
  await ensureHistoryTable();
  const db = await getDb();
  const id = `${memory.id}-${Date.now()}`;
  
  await db.execute({
    sql: `INSERT INTO memory_history (id, memory_id, content, tags, type, change_type) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, memory.id, memory.content, memory.tags, memory.type, changeType],
  });
}

export const historyCommand = new Command("history")
  .description("View version history of a memory")
  .argument("<id>", "Memory ID")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    try {
      await ensureHistoryTable();
      const db = await getDb();
      
      // Get current memory
      const memory = await getMemoryById(id);
      
      // Get history
      const result = await db.execute({
        sql: `SELECT *, ROW_NUMBER() OVER (ORDER BY changed_at ASC) as version 
              FROM memory_history 
              WHERE memory_id = ? 
              ORDER BY changed_at DESC`,
        args: [id],
      });
      
      const history = result.rows as unknown as HistoryEntry[];
      
      if (opts.json) {
        console.log(JSON.stringify({ current: memory, history }, null, 2));
        return;
      }
      
      if (!memory && history.length === 0) {
        console.error(chalk.red("✗") + ` Memory ${id} not found`);
        process.exit(1);
      }
      
      const icon = memory ? TYPE_ICONS[memory.type] || "📝" : "📝";
      
      console.log("");
      if (memory) {
        console.log(`${icon} ${chalk.bold(memory.content)}`);
        console.log(chalk.dim(`ID: ${id}`));
      } else {
        console.log(chalk.dim(`Memory ${id} (deleted)`));
      }
      console.log("");
      
      if (history.length === 0) {
        console.log(chalk.dim("No version history recorded."));
        console.log(chalk.dim("History is recorded when memories are updated."));
        return;
      }
      
      console.log(chalk.bold("History:"));
      console.log(chalk.dim("─".repeat(60)));
      
      for (const entry of history) {
        const changeIcon = entry.change_type === "created" ? "+" : 
                          entry.change_type === "updated" ? "~" : 
                          "-";
        const changeColor = entry.change_type === "created" ? chalk.green : 
                           entry.change_type === "updated" ? chalk.yellow : 
                           chalk.red;
        
        const date = new Date(entry.changed_at).toLocaleDateString();
        const time = new Date(entry.changed_at).toLocaleTimeString();
        
        console.log(`  ${changeColor(changeIcon)} v${entry.version}  ${chalk.dim(date + " " + time)}`);
        console.log(`    "${entry.content.slice(0, 60)}${entry.content.length > 60 ? "..." : ""}"`);
      }
      
      console.log(chalk.dim("─".repeat(60)));
      console.log(chalk.dim(`\nUse 'memories revert ${id} --to <version>' to restore a previous version`));
    } catch (error) {
      console.error(chalk.red("✗") + " Failed:", error instanceof Error ? error.message : "Unknown error");
      process.exit(1);
    }
  });

export const revertCommand = new Command("revert")
  .description("Revert a memory to a previous version")
  .argument("<id>", "Memory ID")
  .requiredOption("--to <version>", "Version number to revert to")
  .action(async (id: string, opts: { to: string }) => {
    try {
      await ensureHistoryTable();
      const db = await getDb();
      
      const version = parseInt(opts.to.replace("v", ""), 10);
      if (isNaN(version) || version < 1) {
        console.error(chalk.red("✗") + " Invalid version number");
        process.exit(1);
      }
      
      // Get the specific version
      const result = await db.execute({
        sql: `SELECT *, ROW_NUMBER() OVER (ORDER BY changed_at ASC) as version 
              FROM memory_history 
              WHERE memory_id = ?`,
        args: [id],
      });
      
      const history = result.rows as unknown as HistoryEntry[];
      const targetEntry = history.find(h => h.version === version);
      
      if (!targetEntry) {
        console.error(chalk.red("✗") + ` Version ${version} not found for memory ${id}`);
        process.exit(1);
      }
      
      // Get current memory to record history before revert
      const current = await getMemoryById(id);
      if (current) {
        await recordHistory(current, "updated");
      }
      
      // Update memory with old content
      const updated = await updateMemory(id, {
        content: targetEntry.content,
        tags: targetEntry.tags ? targetEntry.tags.split(",") : undefined,
      });
      
      if (!updated) {
        console.error(chalk.red("✗") + ` Failed to revert memory ${id}`);
        process.exit(1);
      }
      
      console.log(chalk.green("✓") + ` Reverted memory ${chalk.dim(id)} to version ${version}`);
      console.log(chalk.dim(`  "${targetEntry.content.slice(0, 60)}${targetEntry.content.length > 60 ? "..." : ""}"`));
    } catch (error) {
      console.error(chalk.red("✗") + " Failed:", error instanceof Error ? error.message : "Unknown error");
      process.exit(1);
    }
  });
