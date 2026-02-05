import { Command } from "commander";
import chalk from "chalk";
import { initConfig, readConfig } from "../lib/config.js";
import { 
  getAvailableModels, 
  getCurrentModelInfo, 
  setEmbeddingModel,
  clearAllEmbeddings,
  type EmbeddingModel,
} from "../lib/embeddings.js";
import { confirm } from "@inquirer/prompts";

export const configCommand = new Command("config")
  .description("Manage agent configuration");

configCommand
  .command("init")
  .description("Initialize .agents/config.yaml in current directory")
  .action(async () => {
    const path = await initConfig(process.cwd());
    console.log(`Created config at ${path}`);
  });

configCommand
  .command("show")
  .description("Show current agent configuration")
  .action(async () => {
    const config = await readConfig(process.cwd());
    if (!config) {
      console.log("No .agents/config.yaml found. Run `memories config init` first.");
      return;
    }
    console.log(JSON.stringify(config, null, 2));
  });

// ─── Model Configuration ──────────────────────────────────────────────────────

function formatModelRow(model: EmbeddingModel, isCurrent: boolean): string {
  const marker = isCurrent ? chalk.green("→ ") : "  ";
  const speedColor = model.speed === "fast" ? chalk.green : model.speed === "medium" ? chalk.yellow : chalk.red;
  const qualityColor = model.quality === "best" ? chalk.green : model.quality === "better" ? chalk.yellow : chalk.dim;
  
  return `${marker}${chalk.bold(model.id.padEnd(22))} ${String(model.dimensions).padStart(4)}d  ${speedColor(model.speed.padEnd(6))}  ${qualityColor(model.quality.padEnd(6))}  ${chalk.dim(model.description)}`;
}

configCommand
  .command("model")
  .description("Show or change the embedding model")
  .argument("[model-id]", "Model ID to switch to (omit to show current)")
  .option("--list", "List all available models")
  .option("-y, --yes", "Skip confirmation when changing models")
  .action(async (modelId: string | undefined, opts: { list?: boolean; yes?: boolean }) => {
    try {
      const currentModel = getCurrentModelInfo();
      
      // List all models
      if (opts.list || (!modelId && !opts.list)) {
        console.log(chalk.bold("\nEmbedding Models\n"));
        console.log(chalk.dim("  ID                      Dim   Speed   Quality  Description"));
        console.log(chalk.dim("  ─".repeat(40)));
        
        for (const model of getAvailableModels()) {
          console.log(formatModelRow(model, model.id === currentModel.id));
        }
        
        console.log("");
        console.log(chalk.dim(`Current: ${currentModel.id} (${currentModel.dimensions} dimensions)`));
        console.log(chalk.dim(`Change with: memories config model <model-id>`));
        return;
      }
      
      // Set model
      if (modelId) {
        if (modelId === currentModel.id) {
          console.log(chalk.yellow("⚠") + ` Already using ${modelId}`);
          return;
        }
        
        const result = setEmbeddingModel(modelId);
        
        console.log(chalk.green("✓") + ` Switched to ${chalk.bold(result.model.id)}`);
        console.log(chalk.dim(`  ${result.model.description}`));
        console.log(chalk.dim(`  Dimensions: ${result.model.dimensions}, Speed: ${result.model.speed}, Quality: ${result.model.quality}`));
        
        // Handle dimension change
        if (result.dimensionChanged) {
          console.log("");
          console.log(chalk.yellow("⚠") + chalk.bold(" Dimension change detected"));
          console.log(chalk.dim(`  Previous: ${result.previousDimensions}d → New: ${result.model.dimensions}d`));
          console.log(chalk.dim("  Existing embeddings are incompatible and should be regenerated."));
          console.log("");
          
          const shouldClear = opts.yes || await confirm({
            message: "Clear existing embeddings? (They will be regenerated on next use or via `memories embed`)",
            default: true,
          });
          
          if (shouldClear) {
            const cleared = await clearAllEmbeddings();
            console.log(chalk.green("✓") + ` Cleared ${cleared} embeddings`);
            console.log(chalk.dim("  Run `memories embed` to regenerate embeddings with the new model."));
          } else {
            console.log(chalk.yellow("⚠") + " Keeping old embeddings. Semantic search may not work correctly.");
            console.log(chalk.dim("  Run `memories embed --all` later to regenerate."));
          }
        }
      }
    } catch (error) {
      console.error(chalk.red("✗") + ` Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });
