import { Command } from "commander";
import chalk from "chalk";
import { readFile } from "node:fs/promises";
import * as ui from "../lib/ui.js";
import { addMemory, isMemoryType, type MemoryType } from "../lib/memory.js";

interface ImportMemory {
  id?: string;
  content: string;
  type?: MemoryType;
  tags?: string[];
  scope?: "global" | "project";
}

interface ImportData {
  version?: string;
  memories: ImportMemory[];
}

export const importCommand = new Command("import")
  .description("Import memories from JSON or YAML file")
  .argument("<file>", "Input file path")
  .option("-f, --format <format>", "Input format: json, yaml (auto-detected from extension)")
  .option("-g, --global", "Import all as global memories (override file scope)")
  .option("--dry-run", "Show what would be imported without actually importing")
  .action(async (file: string, opts: { 
    format?: string;
    global?: boolean;
    dryRun?: boolean;
  }) => {
    try {
      const content = await readFile(file, "utf-8");
      
      // Auto-detect format from extension if not specified
      let format = opts.format;
      if (!format) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          format = "yaml";
        } else {
          format = "json";
        }
      }

      let data: unknown;
      if (format === "yaml") {
        const yaml = await import("yaml");
        data = yaml.parse(content);
      } else {
        data = JSON.parse(content);
      }

      if (!data || typeof data !== "object" || !("memories" in data) || !Array.isArray((data as ImportData).memories)) {
        ui.error("Invalid import file: missing 'memories' array");
        process.exit(1);
      }

      const importData = data as ImportData;

      // Validate and filter entries
      let skipped = 0;
      const validMemories: ImportMemory[] = [];
      for (const m of importData.memories) {
        if (!m.content || typeof m.content !== "string" || m.content.trim().length === 0) {
          skipped++;
          continue;
        }
        if (m.type && !isMemoryType(m.type)) {
          ui.warn(`Skipping memory with invalid type "${m.type}": ${m.content.slice(0, 50)}`);
          skipped++;
          continue;
        }
        validMemories.push(m);
      }

      if (opts.dryRun) {
        console.log(chalk.blue("Dry run - would import:"));
        for (const m of validMemories) {
          const type = m.type || "note";
          const scope = opts.global ? "global" : (m.scope || "project");
          const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
          console.log(`  ${type} (${scope}): ${m.content}${tags}`);
        }
        console.log(chalk.dim(`\n${validMemories.length} memories would be imported`));
        if (skipped > 0) console.log(chalk.dim(`${skipped} entries skipped (invalid)`));
        return;
      }

      let imported = 0;
      let failed = 0;

      for (const m of validMemories) {
        try {
          await addMemory(m.content, {
            type: m.type || "note",
            tags: m.tags,
            global: opts.global || m.scope === "global",
          });
          imported++;
        } catch (error) {
          ui.warn(`Failed to import: ${m.content.slice(0, 50)}...`);
          failed++;
        }
      }

      ui.success(`Imported ${imported} memories`);
      if (failed > 0) {
        ui.warn(`${failed} memories failed to import`);
      }
      if (skipped > 0) {
        console.log(chalk.dim(`${skipped} entries skipped (invalid content or type)`));
      }
    } catch (error) {
      ui.error("Failed to import: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
