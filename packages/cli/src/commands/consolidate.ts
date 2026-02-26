import { Command } from "commander";
import chalk from "chalk";
import * as ui from "../lib/ui.js";
import { consolidateMemories, isMemoryType, type MemoryType } from "../lib/memory.js";

const DEFAULT_TYPES: readonly MemoryType[] = ["rule", "decision", "fact", "note"] as const;

function parseTypesOption(value: string | undefined): MemoryType[] | undefined {
  if (!value) return undefined;

  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (parsed.length === 0) return undefined;

  const unique = [...new Set(parsed)];
  const invalid = unique.filter((candidate) => !isMemoryType(candidate));
  if (invalid.length > 0) {
    throw new Error(`Invalid memory types: ${invalid.join(", ")}`);
  }

  return unique as MemoryType[];
}

export const consolidateCommand = new Command("consolidate")
  .description("Run memory consolidation workflows");

consolidateCommand.addCommand(
  new Command("run")
    .description("Consolidate duplicate memories and supersede outdated entries")
    .option(
      "--types <types>",
      `Comma-separated memory types to include (default: ${DEFAULT_TYPES.join(",")})`
    )
    .option("--project-id <id>", "Explicit project id (defaults to current git project)")
    .option("--global-only", "Restrict consolidation to global memories only")
    .option("--no-include-global", "Exclude global memories from project-scoped runs")
    .option("--dry-run", "Preview consolidation effects without mutating memory rows")
    .option("--model <name>", "Optional model identifier used for audit metadata")
    .option("--json", "Output as JSON")
    .action(async (opts: {
      types?: string;
      projectId?: string;
      globalOnly?: boolean;
      includeGlobal?: boolean;
      dryRun?: boolean;
      model?: string;
      json?: boolean;
    }) => {
      try {
        const types = parseTypesOption(opts.types) ?? [...DEFAULT_TYPES];
        if (opts.globalOnly && opts.projectId?.trim()) {
          ui.warn("Ignoring --project-id because --global-only was provided.");
        }

        const result = await consolidateMemories({
          projectId: opts.globalOnly ? undefined : opts.projectId?.trim() || undefined,
          includeGlobal: opts.includeGlobal,
          globalOnly: opts.globalOnly,
          types,
          dryRun: opts.dryRun,
          model: opts.model?.trim() || undefined,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const summary = opts.dryRun ? "Dry-run consolidation complete." : "Consolidation complete.";
        ui.success(summary);
        ui.dim(
          `Run ${result.run.id}: input=${result.run.input_count}, merged=${result.run.merged_count}, superseded=${result.run.superseded_count}, conflicts=${result.run.conflicted_count}`
        );

        if (result.supersededMemoryIds.length > 0) {
          console.log("");
          console.log(
            `${chalk.bold("Superseded memories:")} ${result.supersededMemoryIds.length} (${result.supersededMemoryIds
              .slice(0, 8)
              .join(", ")}${result.supersededMemoryIds.length > 8 ? ", ..." : ""})`
          );
        }
      } catch (error) {
        ui.error(`Failed to run consolidation: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    })
);
