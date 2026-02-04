import { Command } from "commander";
import chalk from "chalk";
import { getDb, getConfigDir } from "../lib/db.js";
import { getProjectId, getGitRoot } from "../lib/git.js";
import { addMemory } from "../lib/memory.js";
import { readAuth } from "../lib/auth.js";
import * as ui from "../lib/ui.js";

export const initCommand = new Command("init")
  .description("Initialize memories for the current project or globally")
  .option("-g, --global", "Initialize global memories (user-wide)")
  .option("-r, --rule <rule>", "Add an initial rule", (val, acc: string[]) => [...acc, val], [])
  .action(async (opts: { global?: boolean; rule?: string[] }) => {
    try {
      ui.banner();

      // Step 1: Database
      ui.step(1, 3, "Initializing database...");
      await getDb();
      const configDir = getConfigDir();
      ui.dim(`Database: ${configDir}/local.db`);

      // Step 2: Scope
      ui.step(2, 3, "Detecting scope...");
      let useGlobal = opts.global;
      
      if (!useGlobal) {
        const projectId = getProjectId();
        const gitRoot = getGitRoot();

        if (!projectId) {
          ui.warn("Not in a git repository - using global scope");
          ui.dim("Global memories apply to all projects");
          useGlobal = true;
        } else {
          ui.success("Using project scope");
          ui.dim(`Project: ${projectId}`);
          ui.dim(`Root: ${gitRoot}`);
        }
      }
      
      if (useGlobal) {
        ui.success("Using global scope (applies to all projects)");
      }

      // Step 3: Auth status
      ui.step(3, 3, "Checking account...");
      const auth = await readAuth();
      if (auth) {
        ui.success(`Logged in as ${chalk.bold(auth.email)}`);
      } else {
        ui.dim("Not logged in (local-only mode)");
        ui.dim("Run " + chalk.cyan("memories login") + " for cloud sync");
      }

      // Add initial rules if provided
      if (opts.rule?.length) {
        console.log("");
        ui.info("Adding initial rules...");
        for (const rule of opts.rule) {
          const memory = await addMemory(rule, { 
            type: "rule", 
            global: useGlobal 
          });
          ui.dim(`${memory.id}: ${rule}`);
        }
      }

      // Next steps
      ui.nextSteps([
        `${chalk.cyan("memories add")} ${chalk.dim('"Your first memory"')}`,
        `${chalk.cyan("memories add --rule")} ${chalk.dim('"Always use TypeScript"')}`,
        `${chalk.cyan("memories generate")} ${chalk.dim("to create IDE rule files")}`,
        `${chalk.cyan("memories serve")} ${chalk.dim("to start MCP server")}`,
      ]);
    } catch (error) {
      ui.error("Failed to initialize: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
