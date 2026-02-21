import { Command } from "commander";
import chalk from "chalk";
import * as ui from "../lib/ui.js";
import {
  createReminder,
  deleteReminder,
  listReminders,
  runDueReminders,
  setReminderEnabled,
  type Reminder,
} from "../lib/reminders.js";

function formatTimestamp(value: string | null): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function printReminder(reminder: Reminder): void {
  const scope = reminder.scope === "global" ? chalk.dim("G") : chalk.dim("P");
  const status = reminder.enabled ? chalk.green("enabled") : chalk.dim("disabled");
  const nextRun = formatTimestamp(reminder.next_trigger_at);
  const lastRun = reminder.last_triggered_at ? formatTimestamp(reminder.last_triggered_at) : "never";

  console.log(`  ${scope} ${chalk.bold(reminder.id)}  ${chalk.dim(reminder.cron_expression)}  ${status}`);
  console.log(`      ${reminder.message}`);
  console.log(`      next: ${chalk.cyan(nextRun)}  last: ${chalk.dim(lastRun)}`);
}

export const remindersCommand = new Command("reminders")
  .description("Manage cron-based reminders")
  .alias("reminder");

remindersCommand.addCommand(
  new Command("add")
    .description("Create a reminder with a 5-field cron expression")
    .argument("<cron>", "Cron expression (minute hour day-of-month month day-of-week)")
    .argument("<message...>", "Reminder message")
    .option("-g, --global", "Store as global reminder")
    .option("--json", "Output as JSON")
    .action(async (cron: string, messageParts: string[], opts: { global?: boolean; json?: boolean }) => {
      try {
        const message = messageParts.join(" ").trim();
        if (!message) {
          ui.error("Reminder message cannot be empty");
          process.exit(1);
        }

        const reminder = await createReminder(message, {
          cronExpression: cron,
          global: opts.global,
        });

        if (opts.json) {
          console.log(JSON.stringify(reminder, null, 2));
          return;
        }

        ui.success(`Created reminder ${chalk.dim(reminder.id)} (${reminder.scope})`);
        console.log(chalk.dim(`  ${reminder.cron_expression} -> next ${formatTimestamp(reminder.next_trigger_at)}`));
        console.log(`  ${reminder.message}`);
      } catch (error) {
        ui.error(`Failed to create reminder: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

remindersCommand.addCommand(
  new Command("list")
    .description("List reminders")
    .option("--all", "Include disabled reminders")
    .option("--json", "Output as JSON")
    .action(async (opts: { all?: boolean; json?: boolean }) => {
      try {
        const reminders = await listReminders({ includeDisabled: opts.all });

        if (opts.json) {
          console.log(JSON.stringify(reminders, null, 2));
          return;
        }

        if (reminders.length === 0) {
          console.log(chalk.dim("No reminders found."));
          return;
        }

        console.log(chalk.bold(`Reminders (${reminders.length})\n`));
        for (const reminder of reminders) {
          printReminder(reminder);
        }
      } catch (error) {
        ui.error(`Failed to list reminders: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

remindersCommand.addCommand(
  new Command("run")
    .description("Evaluate and emit due reminders")
    .option("--dry-run", "Preview due reminders without advancing next trigger")
    .option("--json", "Output as JSON")
    .action(async (opts: { dryRun?: boolean; json?: boolean }) => {
      try {
        const result = await runDueReminders({ dryRun: opts.dryRun });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.triggered.length === 0) {
          console.log(chalk.dim(`No due reminders (${result.checkedCount} active checked).`));
          return;
        }

        for (const reminder of result.triggered) {
          console.log(`⏰ ${chalk.bold(reminder.message)}`);
          console.log(chalk.dim(`   id=${reminder.id} cron=${reminder.cron_expression}`));
        }

        if (opts.dryRun) {
          ui.info(`Dry run: ${result.triggered.length} reminder(s) are due.`);
        } else {
          ui.success(`Triggered ${result.triggered.length} reminder(s).`);
        }
      } catch (error) {
        ui.error(`Failed to run reminders: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

remindersCommand.addCommand(
  new Command("enable")
    .description("Enable a reminder")
    .argument("<id>", "Reminder ID")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const reminder = await setReminderEnabled(id, true);
        if (!reminder) {
          ui.error(`Reminder ${id} not found`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(reminder, null, 2));
          return;
        }

        ui.success(`Enabled reminder ${chalk.dim(id)}`);
        console.log(chalk.dim(`  next: ${formatTimestamp(reminder.next_trigger_at)}`));
      } catch (error) {
        ui.error(`Failed to enable reminder: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

remindersCommand.addCommand(
  new Command("disable")
    .description("Disable a reminder")
    .argument("<id>", "Reminder ID")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const reminder = await setReminderEnabled(id, false);
        if (!reminder) {
          ui.error(`Reminder ${id} not found`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(reminder, null, 2));
          return;
        }

        ui.success(`Disabled reminder ${chalk.dim(id)}`);
      } catch (error) {
        ui.error(`Failed to disable reminder: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);

remindersCommand.addCommand(
  new Command("delete")
    .description("Delete a reminder")
    .alias("remove")
    .argument("<id>", "Reminder ID")
    .action(async (id: string) => {
      try {
        const deleted = await deleteReminder(id);
        if (!deleted) {
          ui.error(`Reminder ${id} not found`);
          process.exit(1);
        }

        ui.success(`Deleted reminder ${chalk.dim(id)}`);
      } catch (error) {
        ui.error(`Failed to delete reminder: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    }),
);
