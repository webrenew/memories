import { Command } from "commander";
import chalk from "chalk";
import {
  getContext,
  getRules,
  isContextMode,
  CONTEXT_MODES,
  type ContextMode,
  type Memory,
  type MemoryType,
} from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";
import * as ui from "../lib/ui.js";

const TYPE_ICONS: Record<MemoryType, string> = {
  rule: "📌",
  decision: "💡",
  fact: "📋",
  note: "📝",
  skill: "🔧",
};

const TYPE_COLORS: Record<MemoryType, (text: string) => string> = {
  rule: chalk.yellow,
  decision: chalk.cyan,
  fact: chalk.green,
  note: chalk.white,
  skill: chalk.magenta,
};

function formatMemory(m: Memory, verbose: boolean): string {
  const icon = TYPE_ICONS[m.type] || "📝";
  const colorFn = TYPE_COLORS[m.type] || chalk.white;
  const scope = m.scope === "global" ? chalk.dim("G") : chalk.dim("P");
  const tags = m.tags ? chalk.dim(` [${m.tags}]`) : "";
  
  if (verbose) {
    return `${icon} ${scope} ${chalk.dim(m.id)} ${colorFn(m.content)}${tags}`;
  }
  return `${icon} ${colorFn(m.content)}`;
}

export const recallCommand = new Command("recall")
  .description("Recall context - get rules and relevant memories for AI agents")
  .argument("[query]", "Optional search query to find relevant memories")
  .option("-l, --limit <n>", "Max memories to return (excludes rules)", "10")
  .option("-r, --rules-only", "Only return rules")
  .option("--mode <mode>", "Context mode: all, working, long_term, rules_only", "all")
  .option("-v, --verbose", "Show memory IDs and metadata")
  .option("--json", "Output as JSON (for programmatic use)")
  .action(async (query: string | undefined, opts: { 
    limit: string; 
    rulesOnly?: boolean; 
    mode?: string;
    verbose?: boolean;
    json?: boolean;
  }) => {
    try {
      const projectId = getProjectId();
      const modeRaw = opts.mode ?? "all";
      if (!isContextMode(modeRaw)) {
        ui.error(`Invalid mode "${modeRaw}". Valid modes: ${CONTEXT_MODES.join(", ")}`);
        process.exit(1);
      }

      const mode: ContextMode = opts.rulesOnly ? "rules_only" : modeRaw;

      if (mode === "rules_only") {
        const rules = await getRules({ projectId: projectId ?? undefined });
        
        if (opts.json) {
          console.log(JSON.stringify({ mode, rules, memories: [] }, null, 2));
          return;
        }

        if (rules.length === 0) {
          console.log(chalk.dim("No rules defined."));
          console.log(chalk.dim("Add one with: memories add --rule \"Your rule here\""));
          return;
        }

        console.log(chalk.bold("Rules:"));
        for (const rule of rules) {
          console.log(formatMemory(rule, opts.verbose ?? false));
        }
        return;
      }

      const { rules, memories } = await getContext(query, {
        projectId: projectId ?? undefined,
        limit: parseInt(opts.limit, 10),
        mode,
      });

      if (opts.json) {
        console.log(JSON.stringify({ mode, rules, memories }, null, 2));
        return;
      }

      // Output rules first (they're always relevant)
      if (rules.length > 0) {
        console.log(chalk.bold("Rules:"));
        for (const rule of rules) {
          console.log(formatMemory(rule, opts.verbose ?? false));
        }
        console.log("");
      }

      // Output relevant memories
      if (memories.length > 0) {
        console.log(chalk.bold(query ? `Relevant to "${query}":` : "Recent memories:"));
        for (const m of memories) {
          console.log(formatMemory(m, opts.verbose ?? false));
        }
      } else if (query) {
        console.log(chalk.dim(`No memories found matching "${query}"`));
      }

      if (rules.length === 0 && memories.length === 0) {
        console.log(chalk.dim("No memories found."));
        console.log(chalk.dim("Add some with: memories add \"Your memory here\""));
      }
    } catch (error) {
      ui.error("Failed to recall: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
