import { Command } from "commander";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { getRules, listMemories, isMemoryType, MEMORY_TYPES, type Memory, type MemoryType } from "../lib/memory.js";
import * as ui from "../lib/ui.js";
import { getProjectId } from "../lib/git.js";

type Format = "markdown" | "xml" | "plain";

function formatMarkdown(sections: { title: string; memories: Memory[] }[]): string {
  return sections
    .map(({ title, memories }) => {
      const items = memories.map((m) => `- ${m.content}`).join("\n");
      return `## ${title}\n\n${items}`;
    })
    .join("\n\n");
}

function formatXml(sections: { title: string; memories: Memory[] }[]): string {
  return sections
    .map(({ title, memories }) => {
      const tag = title.toLowerCase().replace(/\s+/g, "-");
      const items = memories.map((m) => `  <item>${m.content}</item>`).join("\n");
      return `<${tag}>\n${items}\n</${tag}>`;
    })
    .join("\n");
}

function formatPlain(sections: { title: string; memories: Memory[] }[]): string {
  return sections
    .flatMap(({ memories }) => memories.map((m) => m.content))
    .join("\n");
}

function copyToClipboard(text: string): boolean {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execFileSync("pbcopy", [], { input: text });
    } else if (platform === "linux") {
      execFileSync("xclip", ["-selection", "clipboard"], { input: text });
    } else if (platform === "win32") {
      execFileSync("clip", [], { input: text });
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const promptCommand = new Command("prompt")
  .description("Output memories formatted for AI system prompts")
  .option("-f, --format <format>", "Output format: markdown, xml, plain (default: markdown)")
  .option("-i, --include <types>", "Include additional types: decisions,facts,notes (comma-separated)")
  .option("-a, --all", "Include all memory types")
  .option("-c, --copy", "Copy output to clipboard")
  .option("-q, --quiet", "No stderr status messages (just the prompt)")
  .action(async (opts: {
    format?: string;
    include?: string;
    all?: boolean;
    copy?: boolean;
    quiet?: boolean;
  }) => {
    try {
      const formatStr = opts.format ?? "markdown";
      if (!["markdown", "xml", "plain"].includes(formatStr)) {
        ui.error(`Invalid format "${opts.format}". Use: markdown, xml, plain`);
        process.exit(1);
      }
      const format = formatStr as Format;

      const projectId = getProjectId() ?? undefined;

      // Always include rules
      const rules = await getRules({ projectId });

      // Determine additional types to include
      const extraTypes: MemoryType[] = [];
      if (opts.all) {
        extraTypes.push("decision", "fact", "note");
      } else if (opts.include) {
        for (const t of opts.include.split(",").map((s) => s.trim())) {
          // Allow plural or singular
          const normalized = t.replace(/s$/, "");
          if (!isMemoryType(normalized)) {
            ui.error(`Invalid type "${t}". Valid: decisions, facts, notes`);
            process.exit(1);
          }
          if (normalized !== "rule") extraTypes.push(normalized);
        }
      }

      // Build sections
      const sections: { title: string; memories: Memory[] }[] = [];

      if (rules.length > 0) {
        const globalRules = rules.filter((r) => r.scope === "global");
        const projectRules = rules.filter((r) => r.scope === "project");

        if (globalRules.length > 0 && projectRules.length > 0) {
          sections.push({ title: "Global Rules", memories: globalRules });
          sections.push({ title: "Project Rules", memories: projectRules });
        } else {
          sections.push({ title: "Rules", memories: rules });
        }
      }

      // Fetch additional types
      for (const type of extraTypes) {
        const memories = await listMemories({
          types: [type],
          projectId,
        });
        if (memories.length > 0) {
          const title = type === "decision" ? "Key Decisions" : type === "fact" ? "Project Facts" : "Notes";
          sections.push({ title, memories });
        }
      }

      if (sections.length === 0) {
        if (!opts.quiet) {
          console.error(chalk.dim("No memories found. Add rules with: memories add --rule \"Your rule\""));
        }
        return;
      }

      // Format output
      let output: string;
      switch (format) {
        case "xml":
          output = formatXml(sections);
          break;
        case "plain":
          output = formatPlain(sections);
          break;
        default:
          output = formatMarkdown(sections);
      }

      // Copy or print
      if (opts.copy) {
        const copied = copyToClipboard(output);
        if (copied) {
          console.log(output);
          if (!opts.quiet) {
            ui.success("Copied to clipboard");
          }
        } else {
          console.log(output);
          if (!opts.quiet) {
            ui.warn("Could not copy to clipboard (unsupported platform)");
          }
        }
      } else {
        console.log(output);
      }
    } catch (error) {
      ui.error("Failed to generate prompt: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
