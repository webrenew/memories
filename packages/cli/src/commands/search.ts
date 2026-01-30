import { Command } from "commander";
import { searchMemories } from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";

export const searchCommand = new Command("search")
  .description("Search memories")
  .argument("<query>", "Search query")
  .option("-l, --limit <n>", "Max results", "20")
  .option("-g, --global", "Search only global memories")
  .option("--project-only", "Search only project memories (exclude global)")
  .action(async (query: string, opts: { limit: string; global?: boolean; projectOnly?: boolean }) => {
    // Determine scope filtering
    let globalOnly = false;
    let includeGlobal = true;
    let projectId: string | undefined;
    
    if (opts.global) {
      // Only global - skip project auto-detect
      globalOnly = true;
    } else if (opts.projectOnly) {
      // Only project - disable global
      includeGlobal = false;
      projectId = getProjectId() ?? undefined;
      if (!projectId) {
        console.log("Not in a git repository. No project memories to search.");
        return;
      }
    }
    // Default: both global and project (auto-detect from git)

    const memories = await searchMemories(query, {
      limit: parseInt(opts.limit, 10),
      projectId,
      includeGlobal,
      globalOnly,
    });

    if (memories.length === 0) {
      console.log("No memories found.");
      return;
    }

    for (const m of memories) {
      const tags = m.tags ? ` [${m.tags}]` : "";
      const scope = m.scope === "global" ? "G" : "P";
      console.log(`${scope} ${m.id}  ${m.content}${tags}  (${m.created_at})`);
    }
  });
