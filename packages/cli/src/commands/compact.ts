import { Command } from "commander";
import chalk from "chalk";
import { runInactivityCompactionWorker } from "../lib/memory.js";
import * as ui from "../lib/ui.js";

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

export const compactCommand = new Command("compact")
  .description("Run memory compaction worker routines");

compactCommand.addCommand(
  new Command("run")
    .description("Run inactivity compaction worker for active sessions")
    .option("--inactivity-minutes <n>", "Session inactivity threshold in minutes", "60")
    .option("--limit <n>", "Maximum sessions to process", "25")
    .option("--event-window <n>", "Recent meaningful events included in checkpoint summaries", "8")
    .option("--json", "Output as JSON")
    .action(async (opts: {
      inactivityMinutes: string;
      limit: string;
      eventWindow: string;
      json?: boolean;
    }) => {
      try {
        const result = await runInactivityCompactionWorker({
          inactivityMinutes: parsePositiveInt(opts.inactivityMinutes, "inactivity-minutes"),
          limit: parsePositiveInt(opts.limit, "limit"),
          eventWindow: parsePositiveInt(opts.eventWindow, "event-window"),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        ui.success(
          `Compaction worker processed ${chalk.bold(String(result.scanned))} sessions; compacted ${chalk.bold(String(result.compacted))}.`
        );
        ui.dim(`Inactivity threshold: ${result.inactivityMinutes} minutes`);

        if (result.failures.length > 0) {
          console.log("");
          ui.warn(`Failed sessions (${result.failures.length}):`);
          for (const failure of result.failures) {
            console.log(`  ${chalk.dim(failure.sessionId)} ${failure.error}`);
          }
        }
      } catch (error) {
        ui.error(`Failed to run compaction worker: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    })
);
