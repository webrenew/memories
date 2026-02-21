import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addMemory,
  searchMemories,
  listMemories,
  forgetMemory,
  updateMemory,
  getContext,
  getRules,
  findMemoriesToForget,
  bulkForgetByIds,
  vacuumMemories,
} from "../lib/memory.js";
import {
  createReminder,
  listReminders,
  runDueReminders,
  setReminderEnabled,
  deleteReminder,
} from "../lib/reminders.js";
import { resolveMemoryScopeInput } from "./scope.js";
import {
  TYPE_LABELS,
  formatMemory,
  formatRulesSection,
  formatMemoriesSection,
  withStorageWarnings,
} from "./formatters.js";

// ─── Core Tool Registrations ─────────────────────────────────────────────────

export function registerCoreTools(server: McpServer, projectId: string | null): void {
  // Tool: get_context (PRIMARY - use this for AI agent context)
  server.tool(
    "get_context",
    `Get relevant context for the current task. This is the PRIMARY tool for AI agents.
Returns:
1. All active RULES (coding standards, preferences) - always included
2. Relevant memories matching your query (decisions, facts, notes)

Use this at the start of tasks to understand project conventions and recall past decisions.`,
    {
      query: z.string().optional().describe("What you're working on - used to find relevant memories. Leave empty to get just rules."),
      limit: z.number().optional().describe("Max memories to return (default: 10, rules always included)"),
    },
    async ({ query, limit }) => {
      try {
        const { rules, memories } = await getContext(query, {
          projectId: projectId ?? undefined,
          limit,
        });

        const parts: string[] = [];

        if (rules.length > 0) {
          parts.push(formatRulesSection(rules));
        }

        if (memories.length > 0) {
          parts.push(formatMemoriesSection(memories, query ? `Relevant to: "${query}"` : "Recent Memories"));
        }

        if (parts.length === 0) {
          return {
            content: [{ type: "text", text: "No context found. Use add_memory to store rules and knowledge." }],
          };
        }

        return {
          content: [{ type: "text", text: parts.join("\n\n") }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to get context: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: add_memory
  server.tool(
    "add_memory",
    `Store a new memory. Choose the appropriate type:
- rule: Coding standards, preferences, constraints (e.g., "Always use TypeScript strict mode")
- decision: Why we chose something (e.g., "Chose PostgreSQL for JSONB support")
- fact: Project-specific knowledge (e.g., "API rate limit is 100 req/min")
- note: General notes (default)
- skill: Agent skill definition (e.g., deploy, review workflows)

By default, memories are project-scoped when in a git repo. Use global: true for user-wide preferences.
Use project_id to force project scope when running outside the target repository.
Use paths to scope rules to specific files (e.g., ["src/api/**", "**/*.test.ts"]).
Use category to group related memories (e.g., "api", "testing").`,
    {
      content: z.string().describe("The memory content to store"),
      type: z.enum(["rule", "decision", "fact", "note", "skill"]).optional().describe("Memory type (default: note)"),
      tags: z.array(z.string()).optional().describe("Tags to categorize the memory"),
      global: z.boolean().optional().describe("Store as global memory instead of project-scoped"),
      project_id: z.string().optional().describe("Explicit project id (e.g., github.com/org/repo)"),
      paths: z.array(z.string()).optional().describe("Glob patterns for path-scoped rules (e.g., ['src/api/**', '**/*.test.ts'])"),
      category: z.string().optional().describe("Grouping key for organizing memories (e.g., 'api', 'testing')"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Extended attributes as key-value pairs"),
    },
    async ({ content, type, tags, global: isGlobal, project_id, paths, category, metadata }) => {
      try {
        const scopeOpts = resolveMemoryScopeInput({ global: isGlobal, project_id });
        const memory = await addMemory(content, {
          tags,
          ...scopeOpts,
          type,
          paths,
          category,
          metadata,
        });
        const typeLabel = TYPE_LABELS[memory.type];
        return withStorageWarnings({
          content: [
            {
              type: "text",
              text: `Stored ${typeLabel} ${memory.id} (${memory.scope}${memory.project_id ? `: ${memory.project_id}` : ""})`,
            },
          ],
        });
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to add memory: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: search_memories
  server.tool(
    "search_memories",
    "Search memories by content using full-text search. Returns both global and project-scoped memories ranked by relevance.",
    {
      query: z.string().describe("Search query - words are matched with prefix matching"),
      limit: z.number().optional().describe("Maximum number of results (default: 20)"),
      types: z.array(z.enum(["rule", "decision", "fact", "note", "skill"])).optional().describe("Filter by memory types"),
    },
    async ({ query, limit, types }) => {
      try {
        const memories = await searchMemories(query, {
          limit,
          projectId: projectId ?? undefined,
          types,
        });

        if (memories.length === 0) {
          return {
            content: [{ type: "text", text: "No memories found matching your query." }],
          };
        }

        const formatted = memories.map(formatMemory).join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Found ${memories.length} memories:\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to search memories: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: get_rules
  server.tool(
    "get_rules",
    "Get all active rules for the current project. Rules are coding standards, preferences, and constraints that should always be followed.",
    {},
    async () => {
      try {
        const rules = await getRules({ projectId: projectId ?? undefined });

        if (rules.length === 0) {
          return {
            content: [{ type: "text", text: "No rules defined. Add rules with: add_memory with type='rule'" }],
          };
        }

        const globalRules = rules.filter(r => r.scope === "global");
        const projectRules = rules.filter(r => r.scope === "project");

        const parts: string[] = [];
        if (globalRules.length > 0) {
          parts.push(`## Global Rules\n${globalRules.map(r => `- ${r.content}`).join("\n")}`);
        }
        if (projectRules.length > 0) {
          parts.push(`## Project Rules\n${projectRules.map(r => `- ${r.content}`).join("\n")}`);
        }

        return {
          content: [{ type: "text", text: parts.join("\n\n") }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to get rules: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: list_memories
  server.tool(
    "list_memories",
    "List recent memories. Returns both global and project-scoped memories.",
    {
      limit: z.number().optional().describe("Maximum number of results (default: 50)"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
      types: z.array(z.enum(["rule", "decision", "fact", "note", "skill"])).optional().describe("Filter by memory types"),
    },
    async ({ limit, tags, types }) => {
      try {
        const memories = await listMemories({
          limit,
          tags,
          projectId: projectId ?? undefined,
          types,
        });

        if (memories.length === 0) {
          return {
            content: [{ type: "text", text: "No memories found." }],
          };
        }

        const formatted = memories.map(formatMemory).join("\n");
        return {
          content: [
            {
              type: "text",
              text: `${memories.length} memories:\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list memories: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: edit_memory
  server.tool(
    "edit_memory",
    `Update an existing memory's content, type, tags, paths, category, or metadata. Use this to refine or correct memories.
Find the memory ID first with search_memories or list_memories.`,
    {
      id: z.string().describe("The memory ID to edit"),
      content: z.string().optional().describe("New content for the memory"),
      type: z.enum(["rule", "decision", "fact", "note", "skill"]).optional().describe("New type for the memory"),
      tags: z.array(z.string()).optional().describe("New tags (replaces existing tags)"),
      paths: z.array(z.string()).optional().describe("New glob patterns for path-scoped rules"),
      category: z.string().nullable().optional().describe("New grouping key (null to clear)"),
      metadata: z.record(z.string(), z.unknown()).nullable().optional().describe("New extended attributes (null to clear)"),
    },
    async ({ id, content, type, tags, paths, category, metadata }) => {
      try {
        if (!content && !type && !tags && !paths && category === undefined && metadata === undefined) {
          return {
            content: [{ type: "text", text: "Nothing to update. Provide at least one of: content, type, tags, paths, category, metadata." }],
            isError: true,
          };
        }
        const updated = await updateMemory(id, {
          content,
          type,
          tags,
          paths,
          category,
          metadata,
        });
        if (updated) {
          const typeLabel = TYPE_LABELS[updated.type];
          return withStorageWarnings({
            content: [{ type: "text", text: `Updated ${typeLabel} ${updated.id}: ${updated.content}` }],
          });
        }
        return {
          content: [{ type: "text", text: `Memory ${id} not found or already deleted.` }],
          isError: true,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to edit memory: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: forget_memory
  server.tool(
    "forget_memory",
    "Soft-delete a memory by ID. The memory can be recovered if needed.",
    {
      id: z.string().describe("The memory ID to forget"),
    },
    async ({ id }) => {
      try {
        const deleted = await forgetMemory(id);
        if (deleted) {
          return withStorageWarnings({
            content: [{ type: "text", text: `Forgot memory ${id}` }],
          });
        }
        return {
          content: [{ type: "text", text: `Memory ${id} not found or already forgotten.` }],
          isError: true,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to forget memory: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: bulk_forget_memories
  server.tool(
    "bulk_forget_memories",
    `Bulk soft-delete memories matching filters. Use dry_run:true to preview which memories would be deleted.
Requires at least one filter, or all:true to delete everything. Cannot combine all:true with other filters.`,
    {
      types: z.array(z.enum(["rule", "decision", "fact", "note", "skill"])).optional().describe("Filter by memory types"),
      tags: z.array(z.string()).optional().describe("Filter by tags (substring match)"),
      older_than_days: z.number().int().min(1).optional().describe("Delete memories older than N days (must be >= 1)"),
      pattern: z.string().optional().describe("Content pattern (* as wildcard, ? as single-char wildcard)"),
      project_id: z.string().optional().describe("Scope deletion to a specific project"),
      all: z.boolean().optional().describe("Delete all memories (cannot combine with other filters)"),
      dry_run: z.boolean().optional().describe("Preview which memories would be deleted without deleting them (default: false)"),
    },
    async ({ types, tags, older_than_days, pattern, project_id, all, dry_run }) => {
      try {
        const isAll = all === true;
        const hasFilters = !!(types?.length || tags?.length || older_than_days || pattern);

        if (isAll && hasFilters) {
          return {
            content: [{ type: "text", text: "Cannot combine all:true with other filters." }],
            isError: true,
          };
        }
        if (!isAll && !hasFilters) {
          return {
            content: [{ type: "text", text: "Provide at least one filter (types, tags, older_than_days, pattern), or use all:true. project_id alone is not a sufficient filter." }],
            isError: true,
          };
        }

        const scopeOpts = resolveMemoryScopeInput({ project_id });
        const filter = {
          types,
          tags,
          olderThanDays: older_than_days,
          pattern,
          all: isAll,
          projectId: scopeOpts.projectId,
        };

        const matches = await findMemoriesToForget(filter);

        if (dry_run) {
          if (matches.length === 0) {
            return {
              content: [{ type: "text", text: "Dry run: 0 memories would be deleted" }],
            };
          }
          const preview = matches.slice(0, 1000).map((m) => {
            const preview = m.content.length > 80 ? `${m.content.slice(0, 80).trim()}...` : m.content;
            return `  ${m.id} [${m.type}] ${preview}`;
          }).join("\n");
          const msg = matches.length > 1000
            ? `Dry run: ${matches.length} memories would be deleted (showing first 1000):\n${preview}`
            : `Dry run: ${matches.length} memories would be deleted:\n${preview}`;
          return withStorageWarnings({
            content: [{ type: "text", text: msg }],
          });
        }

        if (matches.length === 0) {
          return {
            content: [{ type: "text", text: "No memories matched the filters" }],
          };
        }

        const ids = matches.map((m) => m.id);
        const count = await bulkForgetByIds(ids);
        return withStorageWarnings({
          content: [{ type: "text", text: `Bulk deleted ${count} memories` }],
        });
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to bulk forget: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: vacuum_memories
  server.tool(
    "vacuum_memories",
    "Permanently purge all soft-deleted memories to reclaim storage space. This action is irreversible.",
    {},
    async () => {
      try {
        const purged = await vacuumMemories();
        const message = purged > 0
          ? `Vacuumed ${purged} soft-deleted memories`
          : "No soft-deleted memories to vacuum";
        return withStorageWarnings({
          content: [{ type: "text", text: message }],
        });
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to vacuum: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: add_reminder
  server.tool(
    "add_reminder",
    "Create a cron-based reminder. Local CLI MCP only.",
    {
      cron_expression: z
        .string()
        .describe("5-field cron expression: minute hour day-of-month month day-of-week"),
      message: z.string().describe("Reminder message"),
      global: z.boolean().optional().describe("Store as global reminder"),
      project_id: z.string().optional().describe("Explicit project id (e.g., github.com/org/repo)"),
    },
    async ({ cron_expression, message, global: isGlobal, project_id }) => {
      try {
        const scopeOpts = resolveMemoryScopeInput({ global: isGlobal, project_id });
        const reminder = await createReminder(message, {
          cronExpression: cron_expression,
          ...scopeOpts,
        });
        return {
          content: [
            {
              type: "text",
              text: `Created reminder ${reminder.id} (${reminder.scope}) next at ${reminder.next_trigger_at ?? "n/a"}: ${reminder.message}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to add reminder: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: list_reminders
  server.tool(
    "list_reminders",
    "List reminders for the current scope (global + project when project_id is provided). Local CLI MCP only.",
    {
      include_disabled: z.boolean().optional().describe("Include disabled reminders"),
      project_id: z.string().optional().describe("Explicit project id (e.g., github.com/org/repo)"),
    },
    async ({ include_disabled, project_id }) => {
      try {
        const reminders = await listReminders({
          includeDisabled: include_disabled,
          projectId: project_id?.trim() ? project_id.trim() : undefined,
        });

        if (reminders.length === 0) {
          return {
            content: [{ type: "text", text: "No reminders found." }],
          };
        }

        const formatted = reminders
          .map((reminder) => {
            const status = reminder.enabled ? "enabled" : "disabled";
            return `- ${reminder.id} [${status}] ${reminder.cron_expression} :: ${reminder.message} (next: ${reminder.next_trigger_at ?? "n/a"})`;
          })
          .join("\n");
        return {
          content: [{ type: "text", text: `${reminders.length} reminders:\n${formatted}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list reminders: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: run_due_reminders
  server.tool(
    "run_due_reminders",
    "Evaluate and emit due reminders; advances next trigger unless dry_run is true. Local CLI MCP only.",
    {
      dry_run: z.boolean().optional().describe("Preview due reminders without updating next trigger"),
      project_id: z.string().optional().describe("Explicit project id (e.g., github.com/org/repo)"),
    },
    async ({ dry_run, project_id }) => {
      try {
        const result = await runDueReminders({
          dryRun: dry_run,
          projectId: project_id?.trim() ? project_id.trim() : undefined,
        });

        if (result.triggered.length === 0) {
          return {
            content: [{ type: "text", text: `No due reminders (${result.checkedCount} active checked).` }],
          };
        }

        const lines = result.triggered
          .map((reminder) => `- ${reminder.id} :: ${reminder.message} (${reminder.cron_expression})`)
          .join("\n");
        return {
          content: [{ type: "text", text: `Triggered ${result.triggered.length} reminder(s):\n${lines}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to run due reminders: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: enable_reminder
  server.tool(
    "enable_reminder",
    "Enable a reminder and recompute next trigger time. Local CLI MCP only.",
    {
      id: z.string().describe("Reminder ID"),
    },
    async ({ id }) => {
      try {
        const reminder = await setReminderEnabled(id, true);
        if (!reminder) {
          return {
            content: [{ type: "text", text: `Reminder ${id} not found.` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Enabled reminder ${id}. Next trigger: ${reminder.next_trigger_at ?? "n/a"}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to enable reminder: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: disable_reminder
  server.tool(
    "disable_reminder",
    "Disable a reminder. Local CLI MCP only.",
    {
      id: z.string().describe("Reminder ID"),
    },
    async ({ id }) => {
      try {
        const reminder = await setReminderEnabled(id, false);
        if (!reminder) {
          return {
            content: [{ type: "text", text: `Reminder ${id} not found.` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Disabled reminder ${id}.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to disable reminder: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: delete_reminder
  server.tool(
    "delete_reminder",
    "Delete a reminder by ID. Local CLI MCP only.",
    {
      id: z.string().describe("Reminder ID"),
    },
    async ({ id }) => {
      try {
        const deleted = await deleteReminder(id);
        if (!deleted) {
          return {
            content: [{ type: "text", text: `Reminder ${id} not found.` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Deleted reminder ${id}.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to delete reminder: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );
}
