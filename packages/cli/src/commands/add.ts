import { Command } from "commander";
import chalk from "chalk";
import { addMemory, isMemoryType, MEMORY_TYPES, type MemoryType } from "../lib/memory.js";
import { readAuth, getApiClient } from "../lib/auth.js";
import { getTemplate, fillTemplate } from "../lib/templates.js";
import { getStorageWarnings } from "../lib/storage-health.js";
import * as ui from "../lib/ui.js";

export const addCommand = new Command("add")
  .description("Add a new memory")
  .argument("[content]", "Memory content (optional if using --template)")
  .option("-t, --tags <tags>", "Comma-separated tags")
  .option("-g, --global", "Store as global memory (default: project-scoped if in git repo)")
  .option("--type <type>", "Memory type: rule, decision, fact, note (default: note)")
  .option("-r, --rule", "Shorthand for --type rule")
  .option("-d, --decision", "Shorthand for --type decision")
  .option("-f, --fact", "Shorthand for --type fact")
  .option("--template <name>", "Use a template (run 'memories template list' to see options)")
  .option("--paths <globs>", "Comma-separated glob patterns for path-scoped rules")
  .option("--category <name>", "Grouping key for organizing memories")
  .action(async (contentArg: string | undefined, opts: {
    tags?: string;
    global?: boolean;
    type?: string;
    rule?: boolean;
    decision?: boolean;
    fact?: boolean;
    template?: string;
    paths?: string;
    category?: string;
  }) => {
    try {
      // Handle template mode
      let content = contentArg;
      let typeFromTemplate: MemoryType | undefined;
      
      if (opts.template) {
        const template = getTemplate(opts.template);
        if (!template) {
          ui.error(`Template "${opts.template}" not found`);
          ui.dim("Run 'memories template list' to see available templates");
          process.exit(1);
        }
        
        console.log("");
        ui.info(`Using template: ${template.name}`);
        ui.dim(template.description);
        console.log("");
        
        content = await fillTemplate(template);
        typeFromTemplate = template.type;
      }
      
      if (!content) {
        ui.error("Content is required. Provide content or use --template");
        process.exit(1);
      }

      // Check rate limits if logged in
      const auth = await readAuth();
      if (auth) {
        try {
          const apiFetch = getApiClient(auth);
          const res = await apiFetch("/api/db/limits");
          if (res.ok) {
            const limits = (await res.json()) as {
              plan: string;
              memoryLimit: number | null;
              memoryCount: number;
            };
            if (limits.memoryLimit !== null && limits.memoryCount >= limits.memoryLimit) {
              ui.warn(`You've reached the free plan limit of ${limits.memoryLimit.toLocaleString()} memories.`);
              ui.proFeature("Unlimited memories");
              process.exit(1);
            }
          }
        } catch {
          // If limit check fails, allow the add to proceed
        }
      }

      const tags = opts.tags?.split(",").map((t) => t.trim());
      
      // Determine type from flags (template type is default if used)
      let type: MemoryType = typeFromTemplate ?? "note";
      if (opts.rule) type = "rule";
      else if (opts.decision) type = "decision";
      else if (opts.fact) type = "fact";
      else if (opts.type) {
        if (!isMemoryType(opts.type)) {
          console.error(chalk.red("✗") + ` Invalid type "${opts.type}". Valid types: ${MEMORY_TYPES.join(", ")}`);
          process.exit(1);
        }
        type = opts.type;
      }

      const paths = opts.paths?.split(",").map((s) => s.trim()).filter(Boolean);
      const memory = await addMemory(content, { tags, global: opts.global, type, paths, category: opts.category });

      const typeLabel = type === "rule" ? "Rule" : type === "decision" ? "Decision" : type === "fact" ? "Fact" : type === "skill" ? "Skill" : "Note";
      const scopeInfo = memory.scope === "global" ? "global" : "project";
      
      ui.success(`Stored ${chalk.bold(typeLabel.toLowerCase())} ${chalk.dim(memory.id)}`);
      ui.dim(`Scope: ${scopeInfo}${tags?.length ? ` • Tags: ${tags.join(", ")}` : ""}`);
      
      // Hint about generating rule files
      if (type === "rule") {
        console.log("");
        ui.dim(`Run ${chalk.cyan("memories generate")} to update your IDE rule files`);
      }

      try {
        const { warnings } = await getStorageWarnings();
        if (warnings.length > 0) {
          console.log("");
        }
        for (const warning of warnings) {
          ui.warn(warning.message);
          if (warning.remediation.length > 0) {
            ui.dim(warning.remediation[0]);
          }
        }
      } catch {
        // Non-fatal: storage health warning should never block writes.
      }
    } catch (error) {
      ui.error("Failed to add memory: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
