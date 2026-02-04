import { Command } from "commander";
import chalk from "chalk";
import { getDb, getConfigDir } from "../lib/db.js";
import { getProjectId, getGitRoot } from "../lib/git.js";
import { addMemory } from "../lib/memory.js";
import { readAuth } from "../lib/auth.js";
import * as ui from "../lib/ui.js";

const SUPPORTED_TOOLS = [
  { name: "Cursor", cmd: "cursor" },
  { name: "Claude Code", cmd: "claude" },
  { name: "GitHub Copilot", cmd: "copilot" },
  { name: "Windsurf", cmd: "windsurf" },
  { name: "Gemini CLI", cmd: "gemini" },
];

export const initCommand = new Command("init")
  .description("Initialize memories - one place for all your AI coding tools")
  .option("-g, --global", "Initialize global rules (apply to all projects)")
  .option("-r, --rule <rule>", "Add an initial rule", (val, acc: string[]) => [...acc, val], [])
  .action(async (opts: { global?: boolean; rule?: string[] }) => {
    try {
      ui.banner();
      
      console.log(chalk.dim("  One place for your rules. Works with every tool.\n"));

      // Step 1: Database
      ui.step(1, 3, "Setting up rule storage...");
      await getDb();
      const configDir = getConfigDir();
      ui.dim(`Location: ${configDir}/local.db`);

      // Step 2: Scope
      ui.step(2, 3, "Detecting scope...");
      let useGlobal = opts.global;
      
      if (!useGlobal) {
        const projectId = getProjectId();
        const gitRoot = getGitRoot();

        if (!projectId) {
          useGlobal = true;
          ui.success("Global scope (rules apply to all projects)");
        } else {
          ui.success("Project scope detected");
          ui.dim(`Project: ${projectId}`);
          ui.dim(`Root: ${gitRoot}`);
          ui.dim("Use --global for rules that apply everywhere");
        }
      } else {
        ui.success("Global scope (rules apply to all projects)");
      }

      // Step 3: Show supported tools
      ui.step(3, 3, "Supported tools...");
      const toolList = SUPPORTED_TOOLS.map(t => t.name).join(", ");
      ui.success(`${toolList}, + any MCP client`);

      // Add initial rules if provided
      if (opts.rule?.length) {
        console.log("");
        ui.info("Adding rules...");
        for (const rule of opts.rule) {
          const memory = await addMemory(rule, { 
            type: "rule", 
            global: useGlobal 
          });
          ui.dim(`+ ${rule}`);
        }
      }

      // Auth status
      console.log("");
      const auth = await readAuth();
      if (auth) {
        ui.success(`Syncing as ${chalk.bold(auth.email)}`);
      } else {
        ui.dim("Local only. Run " + chalk.cyan("memories login") + " to sync across machines.");
      }

      // Next steps - focus on the workflow
      console.log("");
      console.log(chalk.bold("  Quick Start:"));
      console.log("");
      console.log(chalk.dim("  1. Add your rules:"));
      console.log(`     ${chalk.cyan("memories add --rule")} ${chalk.dim('"Always use TypeScript strict mode"')}`);
      console.log(`     ${chalk.cyan("memories add --rule")} ${chalk.dim('"Prefer functional components in React"')}`);
      console.log("");
      console.log(chalk.dim("  2. Generate for your tools:"));
      console.log(`     ${chalk.cyan("memories generate cursor")}   ${chalk.dim("→ .cursor/rules/memories.mdc")}`);
      console.log(`     ${chalk.cyan("memories generate claude")}   ${chalk.dim("→ CLAUDE.md")}`);
      console.log(`     ${chalk.cyan("memories generate copilot")}  ${chalk.dim("→ .github/copilot-instructions.md")}`);
      console.log(`     ${chalk.cyan("memories generate all")}      ${chalk.dim("→ all tools at once")}`);
      console.log("");
      console.log(chalk.dim("  3. Switch tools anytime - your rules follow you."));
      console.log("");
    } catch (error) {
      ui.error("Failed to initialize: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
