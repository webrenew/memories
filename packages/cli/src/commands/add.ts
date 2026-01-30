import { Command } from "commander";
import { addMemory } from "../lib/memory.js";

export const addCommand = new Command("add")
  .description("Add a new memory")
  .argument("<content>", "Memory content")
  .option("-t, --tags <tags>", "Comma-separated tags")
  .option("-g, --global", "Store as global memory (default: project-scoped if in git repo)")
  .action(async (content: string, opts: { tags?: string; global?: boolean }) => {
    const tags = opts.tags?.split(",").map((t) => t.trim());
    const memory = await addMemory(content, { tags, global: opts.global });
    
    const scopeInfo = memory.scope === "global" 
      ? "(global)" 
      : `(project: ${memory.project_id})`;
    console.log(`Stored memory ${memory.id} ${scopeInfo}`);
  });
