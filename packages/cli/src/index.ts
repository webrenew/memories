import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { recallCommand } from "./commands/recall.js";
import { promptCommand } from "./commands/prompt.js";
import { searchCommand } from "./commands/search.js";
import { listCommand } from "./commands/list.js";
import { forgetCommand } from "./commands/forget.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";
import { configCommand } from "./commands/config.js";
import { serveCommand } from "./commands/serve.js";
import { syncCommand } from "./commands/sync.js";
import { generateCommand } from "./commands/generate.js";
import { editCommand } from "./commands/edit.js";
import { statsCommand } from "./commands/stats.js";
import { doctorCommand } from "./commands/doctor.js";
import { hookCommand } from "./commands/hook.js";
import { ingestCommand } from "./commands/ingest.js";
import { diffCommand } from "./commands/diff.js";
import { tagCommand } from "./commands/tag.js";
import { validateCommand } from "./commands/validate.js";
import { staleCommand, reviewCommand } from "./commands/stale.js";
import { linkCommand, unlinkCommand, showCommand } from "./commands/link.js";
import { templateCommand } from "./commands/template.js";
import { historyCommand, revertCommand } from "./commands/history.js";
import { embedCommand } from "./commands/embed.js";
import { loginCommand, logoutCommand } from "./commands/login.js";
import { filesCommand } from "./commands/files.js";
import { orgCommand } from "./commands/org.js";
import { remindersCommand } from "./commands/reminders.js";
import { CLI_VERSION } from "./lib/version.js";

const program = new Command()
  .name("memories")
  .description("A local-first memory layer for AI agents")
  .version(CLI_VERSION);

// Core commands (most used)
program.addCommand(initCommand);
program.addCommand(addCommand);
program.addCommand(recallCommand);
program.addCommand(promptCommand);

// Query commands
program.addCommand(searchCommand);
program.addCommand(listCommand);

// Management commands
program.addCommand(forgetCommand);
program.addCommand(exportCommand);
program.addCommand(importCommand);
program.addCommand(configCommand);
program.addCommand(serveCommand);
program.addCommand(syncCommand);
program.addCommand(generateCommand);
program.addCommand(editCommand);
program.addCommand(statsCommand);
program.addCommand(doctorCommand);
program.addCommand(hookCommand);
program.addCommand(ingestCommand);
program.addCommand(diffCommand);
program.addCommand(tagCommand);
program.addCommand(validateCommand);
program.addCommand(staleCommand);
program.addCommand(reviewCommand);
program.addCommand(linkCommand);
program.addCommand(unlinkCommand);
program.addCommand(showCommand);
program.addCommand(templateCommand);
program.addCommand(historyCommand);
program.addCommand(revertCommand);
program.addCommand(embedCommand);
program.addCommand(filesCommand);
program.addCommand(orgCommand);
program.addCommand(remindersCommand);

// Auth commands
program.addCommand(loginCommand);
program.addCommand(logoutCommand);

program.parse();
