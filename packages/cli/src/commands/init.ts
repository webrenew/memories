import { Command } from "commander";
import chalk from "chalk";
import { confirm, checkbox } from "@inquirer/prompts";
import { getDb, getConfigDir } from "../lib/db.js";
import { getProjectId, getGitRoot } from "../lib/git.js";
import { addMemory, listMemories } from "../lib/memory.js";
import { readAuth } from "../lib/auth.js";
import { detectTools, getAllTools, setupMcp, type DetectedTool } from "../lib/setup.js";
import { initConfig } from "../lib/config.js";
import { runDoctorChecks } from "./doctor.js";
import * as ui from "../lib/ui.js";
import { execSync } from "node:child_process";

export const initCommand = new Command("init")
  .alias("setup")
  .description("Initialize memories - set up MCP and instruction files for your AI tools")
  .option("-g, --global", "Initialize global rules (apply to all projects)")
  .option("-r, --rule <rule>", "Add an initial rule", (val, acc: string[]) => [...acc, val], [])
  .option("--skip-mcp", "Skip MCP configuration")
  .option("--skip-generate", "Skip generating instruction files")
  .option("--skip-verify", "Skip post-setup verification checks")
  .option("-y, --yes", "Auto-confirm all prompts")
  .action(async (opts: { global?: boolean; rule?: string[]; skipMcp?: boolean; skipGenerate?: boolean; skipVerify?: boolean; yes?: boolean }) => {
    try {
      ui.banner();
      
      console.log(chalk.dim("  One place for your rules. Works with every tool.\n"));

      const totalSteps = opts.skipVerify ? 4 : 5;
      const cwd = process.cwd();

      // Step 1: Database
      ui.step(1, totalSteps, "Setting up local storage...");
      await getDb();
      const configPath = await initConfig(cwd);
      const configDir = getConfigDir();
      ui.dim(`Database: ${configDir}/local.db`);
      ui.dim(`Config: ${configPath}`);

      // Step 2: Scope detection
      ui.step(2, totalSteps, "Detecting scope...");
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
        }
      } else {
        ui.success("Global scope (rules apply to all projects)");
      }

      // Step 3: Detect and configure tools
      ui.step(3, totalSteps, "Detecting AI coding tools...");
      let detected = detectTools(cwd);
      
      if (detected.length === 0) {
        ui.dim("No AI coding tools auto-detected.");
        
        if (!opts.skipMcp) {
          const allTools = getAllTools();
          const selected = await checkbox({
            message: "Which tools do you want to configure?",
            choices: allTools.map(t => ({
              name: t.name,
              value: t,
              checked: false,
            })),
          });

          if (selected.length > 0) {
            detected = selected.map(tool => ({
              tool,
              hasConfig: false,
              hasMcp: false,
              hasInstructions: false,
              globalConfig: false,
            }));
          }
        }
      }

      if (detected.length === 0) {
        ui.dim("No tools selected. MCP will work with any tool that supports it.");
      } else {
        for (const d of detected) {
          const scope = d.globalConfig ? chalk.dim(" [global]") : "";
          const mcpStatus = d.hasMcp ? chalk.green("✓ MCP") : chalk.dim("○ MCP");
          const rulesStatus = d.hasInstructions ? chalk.green("✓ Rules") : chalk.dim("○ Rules");
          console.log(`  ${chalk.white(d.tool.name)}${scope} ${mcpStatus} ${rulesStatus}`);
        }

        // Configure MCP for detected tools
        if (!opts.skipMcp) {
          const toolsNeedingMcp = detected.filter(d => !d.hasMcp);
          
          if (toolsNeedingMcp.length > 0) {
            console.log("");
            const shouldSetupMcp = opts.yes || await confirm({
              message: `Configure MCP for ${toolsNeedingMcp.map(d => d.tool.name).join(", ")}?`,
              default: true,
            });

            if (shouldSetupMcp) {
              for (const d of toolsNeedingMcp) {
                const result = await setupMcp(d.tool, { 
                  cwd, 
                  global: d.globalConfig,
                });
                if (result.success) {
                  ui.success(`${d.tool.name}: ${result.message}`);
                  if (result.path) ui.dim(`  → ${result.path}`);
                } else {
                  ui.warn(`${d.tool.name}: ${result.message}`);
                }
              }
            }
          }
        }

        // Generate instruction files
        if (!opts.skipGenerate) {
          const toolsNeedingInstructions = detected.filter(d => !d.hasInstructions);
          const memories = await listMemories({ limit: 1 });
          
          if (toolsNeedingInstructions.length > 0 && memories.length > 0) {
            console.log("");
            const shouldGenerate = opts.yes || await confirm({
              message: `Generate instruction files for ${toolsNeedingInstructions.map(d => d.tool.name).join(", ")}?`,
              default: true,
            });

            if (shouldGenerate) {
              for (const d of toolsNeedingInstructions) {
                try {
                  execSync(`node ${process.argv[1]} generate ${d.tool.generateCmd} --force`, {
                    cwd,
                    stdio: "pipe",
                  });
                  ui.success(`${d.tool.name}: Generated ${d.tool.instructionFile}`);
                } catch {
                  ui.warn(`${d.tool.name}: Failed to generate instructions`);
                }
              }
            }
          }
        }
      }

      // Step 4: Add initial rules if provided
      ui.step(4, totalSteps, "Finalizing...");
      if (opts.rule?.length) {
        ui.info("Adding rules...");
        for (const rule of opts.rule) {
          await addMemory(rule, { 
            type: "rule", 
            global: useGlobal 
          });
          ui.dim(`+ ${rule}`);
        }
      }

      // Auth status
      const auth = await readAuth();
      if (auth) {
        ui.success(`Syncing as ${chalk.bold(auth.email)}`);
      } else {
        ui.dim("Local only. Run " + chalk.cyan("memories login") + " to sync across machines.");
      }

      if (!opts.skipVerify) {
        ui.step(5, totalSteps, "Running integration verification...");
        const report = await runDoctorChecks();
        const problematicChecks = report.checks.filter((check) => check.status !== "pass");

        if (report.summary.failed > 0) {
          ui.warn(
            `Verification found ${report.summary.failed} failure(s) and ${report.summary.warned} warning(s).`,
          );
        } else if (report.summary.warned > 0) {
          ui.warn(`Verification passed with ${report.summary.warned} warning(s).`);
        } else {
          ui.success("Verification passed (auth, DB, MCP, and graph health checks).");
        }

        if (problematicChecks.length > 0) {
          console.log("");
          console.log(chalk.bold("  Verification fixes:"));
          for (const check of problematicChecks) {
            const icon = check.status === "warn" ? chalk.yellow("⚠") : chalk.red("✗");
            console.log(`  ${icon} ${chalk.bold(check.name)}: ${check.message}`);
            if (check.remediation && check.remediation.length > 0) {
              for (const step of check.remediation) {
                console.log(chalk.dim(`     ↳ ${step}`));
              }
            }
          }
        }
      }

      // Quick start guide
      console.log("");
      console.log(chalk.bold("  Quick Start:"));
      console.log("");
      console.log(chalk.dim("  Add rules:"));
      console.log(`     ${chalk.cyan("memories add --rule")} ${chalk.dim('"Always use TypeScript strict mode"')}`);
      console.log("");
      console.log(chalk.dim("  Regenerate instruction files after adding rules:"));
      console.log(`     ${chalk.cyan("memories generate all")}`);
      console.log("");
      console.log(chalk.dim("  Run full health checks any time:"));
      console.log(`     ${chalk.cyan("memories doctor --fix")}`);
      console.log("");
      console.log(chalk.dim("  Your rules will be available via MCP and in generated files."));
      console.log("");
    } catch (error) {
      if ((error as Error).name === "ExitPromptError") return;
      ui.error("Failed to initialize: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
