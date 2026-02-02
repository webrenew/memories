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

const program = new Command()
  .name("memories")
  .description("A local-first memory layer for AI agents")
  .version("0.1.0");

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

program.parse();
