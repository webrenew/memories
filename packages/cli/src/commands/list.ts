import { Command } from "commander";
import { listMemories } from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";

export const listCommand = new Command("list")
  .description("List memories")
  .option("-l, --limit <n>", "Max results", "50")
  .option("-t, --tags <tags>", "Filter by comma-separated tags")
  .option("-g, --global", "Show only global memories")
  .option("--project-only", "Show only project memories (exclude global)")
  .action(async (opts: { limit: string; tags?: string; global?: boolean; projectOnly?: boolean }) => {
    const tags = opts.tags?.split(",").map((t) => t.trim());
    
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
        console.log("Not in a git repository. No project memories to show.");
        return;
      }
    }
    // Default: both global and project (auto-detect from git)

    const memories = await listMemories({
      limit: parseInt(opts.limit, 10),
      tags,
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
