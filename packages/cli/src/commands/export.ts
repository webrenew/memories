import { Command } from "commander";
import chalk from "chalk";
import { writeFile } from "node:fs/promises";
import * as ui from "../lib/ui.js";
import { listMemories, isMemoryType, MEMORY_TYPES, type Memory, type MemoryType } from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";

interface ExportData {
  version: string;
  exported_at: string;
  project_id: string | null;
  memories: Array<{
    id: string;
    content: string;
    type: MemoryType;
    tags: string[];
    scope: "global" | "project";
    created_at: string;
  }>;
}

export const exportCommand = new Command("export")
  .description("Export memories to JSON or YAML file")
  .option("-o, --output <file>", "Output file path (default: stdout)")
  .option("-f, --format <format>", "Output format: json, yaml (default: json)", "json")
  .option("-g, --global", "Export only global memories")
  .option("--project-only", "Export only project memories")
  .option("--type <type>", "Filter by type: rule, decision, fact, note")
  .action(async (opts: { 
    output?: string; 
    format: string;
    global?: boolean; 
    projectOnly?: boolean;
    type?: string;
  }) => {
    try {
      const projectId = getProjectId();
      
      // Determine scope filtering
      let globalOnly = false;
      let includeGlobal = true;
      let queryProjectId: string | undefined;
      
      if (opts.global) {
        globalOnly = true;
      } else if (opts.projectOnly) {
        includeGlobal = false;
        queryProjectId = projectId ?? undefined;
        if (!queryProjectId) {
          ui.error("Not in a git repository. No project memories to export.");
          process.exit(1);
        }
      }

      // Type filter
      if (opts.type && !isMemoryType(opts.type)) {
        ui.error(`Invalid type "${opts.type}". Valid types: ${MEMORY_TYPES.join(", ")}`);
        process.exit(1);
      }
      const types = opts.type && isMemoryType(opts.type) ? [opts.type] : undefined;

      const memories = await listMemories({
        limit: 10000, // Export all
        types,
        projectId: queryProjectId,
        includeGlobal,
        globalOnly,
      });

      const exportData: ExportData = {
        version: "1.0",
        exported_at: new Date().toISOString(),
        project_id: projectId,
        memories: memories.map(m => ({
          id: m.id,
          content: m.content,
          type: m.type,
          tags: m.tags ? m.tags.split(",") : [],
          scope: m.scope,
          created_at: m.created_at,
        })),
      };

      let output: string;
      if (opts.format === "yaml") {
        // Simple YAML serialization (no external dep needed for basic case)
        const yaml = await import("yaml");
        output = yaml.stringify(exportData);
      } else {
        output = JSON.stringify(exportData, null, 2);
      }

      if (opts.output) {
        await writeFile(opts.output, output, "utf-8");
        ui.success(`Exported ${memories.length} memories to ${chalk.dim(opts.output)}`);
      } else {
        console.log(output);
      }
    } catch (error) {
      ui.error("Failed to export: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
