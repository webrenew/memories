import { Command } from "commander";
import chalk from "chalk";
import { searchMemories, type Memory, type MemoryType } from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";

const TYPE_ICONS: Record<MemoryType, string> = {
  rule: "📌",
  decision: "💡",
  fact: "📋",
  note: "📝",
  skill: "🔧",
};

const VALID_TYPES: MemoryType[] = ["rule", "decision", "fact", "note", "skill"];

function formatMemory(m: Memory, score?: number): string {
  const icon = TYPE_ICONS[m.type] || "📝";
  const scope = m.scope === "global" ? chalk.dim("G") : chalk.dim("P");
  const tags = m.tags ? chalk.dim(` [${m.tags}]`) : "";
  const scoreStr = score !== undefined ? chalk.cyan(` (${Math.round(score * 100)}%)`) : "";
  return `${icon} ${scope} ${chalk.dim(m.id)}  ${m.content}${tags}${scoreStr}`;
}

export const searchCommand = new Command("search")
  .description("Search memories using full-text or semantic search")
  .argument("<query>", "Search query")
  .option("-l, --limit <n>", "Max results", "20")
  .option("--type <type>", "Filter by type: rule, decision, fact, note")
  .option("-g, --global", "Search only global memories")
  .option("--project-only", "Search only project memories (exclude global)")
  .option("-s, --semantic", "Use semantic (AI) search instead of keyword search")
  .option("--json", "Output as JSON")
  .action(async (query: string, opts: { 
    limit: string; 
    type?: string;
    global?: boolean; 
    projectOnly?: boolean;
    semantic?: boolean;
    json?: boolean;
  }) => {
    try {
      // Type filter
      let types: MemoryType[] | undefined;
      if (opts.type) {
        if (!VALID_TYPES.includes(opts.type as MemoryType)) {
          console.error(chalk.red("✗") + ` Invalid type "${opts.type}". Valid types: ${VALID_TYPES.join(", ")}`);
          process.exit(1);
        }
        types = [opts.type as MemoryType];
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
          console.log(chalk.yellow("⚠") + " Not in a git repository. No project memories to search.");
          return;
        }
      }

      // Semantic search
      if (opts.semantic) {
        try {
          const { semanticSearch, isModelAvailable } = await import("../lib/embeddings.js");
          
          if (!await isModelAvailable()) {
            console.log(chalk.yellow("⚠") + " Loading embedding model for first time (this may take a moment)...");
          }
          
          const results = await semanticSearch(query, {
            limit: parseInt(opts.limit, 10),
            projectId,
          });
          
          if (opts.json) {
            console.log(JSON.stringify(results, null, 2));
            return;
          }
          
          if (results.length === 0) {
            console.log(chalk.dim(`No semantically similar memories found for "${query}"`));
            console.log(chalk.dim("Try running 'memories embed' to generate embeddings for existing memories."));
            return;
          }
          
          console.log(chalk.bold(`Semantic results for "${query}":`));
          console.log("");
          for (const r of results) {
            // Fetch full memory for display
            const { getMemoryById } = await import("../lib/memory.js");
            const m = await getMemoryById(r.id);
            if (m) {
              console.log(formatMemory(m, r.score));
            }
          }
          
          console.log(chalk.dim(`\n${results.length} results (semantic search)`));
          return;
        } catch (error) {
          console.error(chalk.red("✗") + " Semantic search failed:", error instanceof Error ? error.message : "Unknown error");
          console.log(chalk.dim("Falling back to keyword search..."));
        }
      }

      // Standard FTS search
      const memories = await searchMemories(query, {
        limit: parseInt(opts.limit, 10),
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
        console.log(chalk.dim(`No memories found matching "${query}"`));
        return;
      }

      console.log(chalk.bold(`Results for "${query}":`));
      console.log("");
      for (const m of memories) {
        console.log(formatMemory(m));
      }
      
      console.log(chalk.dim(`\n${memories.length} results`));
    } catch (error) {
      console.error(chalk.red("✗") + " Failed to search:", error instanceof Error ? error.message : "Unknown error");
      process.exit(1);
    }
  });
