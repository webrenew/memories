import { Command } from "commander";
import chalk from "chalk";
import { listTemplates, getTemplate, fillTemplate } from "../lib/templates.js";
import * as ui from "../lib/ui.js";
import { addMemory } from "../lib/memory.js";

export const templateCommand = new Command("template")
  .description("Manage and use memory templates");

templateCommand
  .command("list")
  .description("List available templates")
  .action(() => {
    const templates = listTemplates();
    
    console.log(chalk.bold("\nAvailable Templates:\n"));
    
    for (const t of templates) {
      const typeIcon = t.type === "rule" ? "📌" : t.type === "decision" ? "💡" : t.type === "fact" ? "📋" : "📝";
      console.log(`  ${chalk.cyan(t.name.padEnd(15))} ${typeIcon} ${t.description}`);
    }
    
    console.log("");
    console.log(chalk.dim("Use: memories template use <name>"));
    console.log("");
  });

templateCommand
  .command("show <name>")
  .description("Show template details and fields")
  .action((name: string) => {
    const template = getTemplate(name);

    if (!template) {
      ui.error(`Template "${name}" not found`);
      console.log(chalk.dim("Run 'memories template list' to see available templates"));
      process.exit(1);
    }
    
    const typeIcon = template.type === "rule" ? "📌" : template.type === "decision" ? "💡" : template.type === "fact" ? "📋" : "📝";
    
    console.log("");
    console.log(chalk.bold(template.name) + ` ${typeIcon} ${template.type}`);
    console.log(chalk.dim(template.description));
    console.log("");
    console.log(chalk.bold("Fields:"));
    
    for (const field of template.fields) {
      const required = field.required ? chalk.red("*") : chalk.dim("(optional)");
      console.log(`  ${field.name.padEnd(15)} ${required}  ${field.prompt}`);
    }
    
    console.log("");
  });

templateCommand
  .command("use <name>")
  .description("Create a memory using a template")
  .option("-g, --global", "Store as global memory")
  .action(async (name: string, opts: { global?: boolean }) => {
    const template = getTemplate(name);

    if (!template) {
      ui.error(`Template "${name}" not found`);
      console.log(chalk.dim("Run 'memories template list' to see available templates"));
      process.exit(1);
    }
    
    console.log("");
    console.log(chalk.bold(`Using template: ${template.name}`));
    console.log(chalk.dim(template.description));
    console.log("");
    
    try {
      const content = await fillTemplate(template);
      
      const memory = await addMemory(content, {
        type: template.type,
        global: opts.global,
      });
      
      console.log("");
      ui.success(`Created ${template.type}: ${chalk.dim(memory.id)}`);
      console.log(chalk.dim(`  "${content}"`));
    } catch (error) {
      // User likely cancelled with Ctrl+C
      if (error instanceof Error && error.message?.includes("User force closed")) {
        console.log("\nCancelled.");
        return;
      }
      throw error;
    }
  });
