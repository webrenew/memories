import { Command } from "commander";
import chalk from "chalk";
import { listMemories, isMemoryType, MEMORY_TYPES, type Memory, type MemoryType } from "../lib/memory.js";
import * as ui from "../lib/ui.js";
import { getProjectId } from "../lib/git.js";

const TYPE_COLORS: Record<MemoryType, (s: string) => string> = {
  rule: chalk.blue,
  decision: chalk.yellow,
  fact: chalk.green,
  note: chalk.dim,
  skill: chalk.magenta,
};

const TYPE_LABELS: Record<MemoryType, string> = {
  rule: "rule",
  decision: "decision",
  fact: "fact",
  note: "note",
  skill: "skill",
};

const MAX_CONTENT_WIDTH = 80;

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function formatMemory(m: Memory): string {
  const typeColor = TYPE_COLORS[m.type] ?? chalk.dim;
  const typeLabel = typeColor(TYPE_LABELS[m.type].padEnd(9));
  const scope = m.scope === "global" ? chalk.magenta("G") : chalk.cyan("P");
  const id = chalk.dim(m.id);
  const content = truncate(m.content, MAX_CONTENT_WIDTH);
  const tags = m.tags ? chalk.dim(` [${m.tags}]`) : "";
  return `  ${scope} ${typeLabel} ${id}  ${content}${tags}`;
}

export const listCommand = new Command("list")
  .description("List memories")
  .option("-l, --limit <n>", "Max results", "50")
  .option("-t, --tags <tags>", "Filter by comma-separated tags")
  .option("--type <type>", "Filter by type: rule, decision, fact, note")
  .option("-g, --global", "Show only global memories")
  .option("--project-only", "Show only project memories (exclude global)")
  .option("--json", "Output as JSON")
  .action(async (opts: { 
    limit: string; 
    tags?: string; 
    type?: string;
    global?: boolean; 
    projectOnly?: boolean;
    json?: boolean;
  }) => {
    try {
      const tags = opts.tags?.split(",").map((t) => t.trim());
      
      // Type filter
      let types: MemoryType[] | undefined;
      if (opts.type) {
        if (!isMemoryType(opts.type)) {
          ui.error(`Invalid type "${opts.type}". Valid types: ${MEMORY_TYPES.join(", ")}`);
          process.exit(1);
        }
        types = [opts.type];
      }
      
      // Determine scope filtering
      let globalOnly = false;
      let includeGlobal = true;
      let projectId: string | undefined;
      
      if (opts.global) {
        globalOnly = true;
      } else if (opts.projectOnly) {
        includeGlobal = false;
        projectId = getProjectId() ?? undefined;
        if (!projectId) {
          ui.warn("Not in a git repository. No project memories to show.");
          return;
        }
      }

      const memories = await listMemories({
        limit: parseInt(opts.limit, 10),
        tags,
        types,
        projectId,
        includeGlobal,
        globalOnly,
      });

      if (opts.json) {
        console.log(JSON.stringify(memories, null, 2));
        return;
      }

      if (memories.length === 0) {
        console.log(chalk.dim("No memories found."));
        return;
      }

      // Group header
      const currentProject = getProjectId();
      if (currentProject && !opts.global) {
        console.log(chalk.dim(`  Project: ${currentProject}\n`));
      }

      for (const m of memories) {
        console.log(formatMemory(m));
      }

      console.log(chalk.dim(`\n  ${memories.length} memories`));
    } catch (error) {
      ui.error("Failed to list memories: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
