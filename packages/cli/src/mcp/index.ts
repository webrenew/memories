import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
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
  startMemoryStream,
  appendMemoryChunk,
  finalizeMemoryStream,
  cancelMemoryStream,
  getStreamState,
  type Memory,
  type MemoryType,
} from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";
import { setCloudMode } from "../lib/db.js";
import { CLI_VERSION } from "../lib/version.js";
import { logger } from "../lib/logger.js";
import { resolveMemoryScopeInput } from "./scope.js";
import {
  formatStorageWarningsForText,
  getStorageWarnings,
  type StorageWarning,
} from "../lib/storage-health.js";

// Re-export for use by serve command
export function setCloudCredentials(url: string, token: string): void {
  setCloudMode(url, token);
}

const TYPE_LABELS: Record<MemoryType, string> = {
  rule: "📌 RULE",
  decision: "💡 DECISION",
  fact: "📋 FACT",
  note: "📝 NOTE",
  skill: "🔧 SKILL",
};

function formatMemory(m: Memory): string {
  const tags = m.tags ? ` [${m.tags}]` : "";
  const scope = m.scope === "global" ? "G" : "P";
  const typeLabel = TYPE_LABELS[m.type] || "📝 NOTE";
  const paths = m.paths ? ` (paths: ${m.paths})` : "";
  const cat = m.category ? ` {${m.category}}` : "";
  return `${typeLabel} (${scope}) ${m.id}: ${m.content}${tags}${paths}${cat}`;
}

function formatRulesSection(rules: Memory[]): string {
  if (rules.length === 0) return "";
  return `## Active Rules\n${rules.map(r => `- ${r.content}`).join("\n")}`;
}

function formatMemoriesSection(memories: Memory[], title: string): string {
  if (memories.length === 0) return "";
  return `## ${title}\n${memories.map(formatMemory).join("\n")}`;
}

interface ToolTextPart {
  type: "text";
  text: string;
}

interface ToolResponsePayload {
  content: ToolTextPart[];
  isError?: boolean;
  [key: string]: unknown;
}

export async function withStorageWarnings(
  result: ToolResponsePayload,
  warningsOverride?: StorageWarning[]
): Promise<ToolResponsePayload> {
  if (result.isError) return result;

  if (result.content.length === 0) return result;

  try {
    const warnings = warningsOverride ?? (await getStorageWarnings()).warnings;
    if (warnings.length === 0) return result;

    const warningBlock = formatStorageWarningsForText(warnings);
    if (!warningBlock) return result;

    const nextContent = [...result.content];
    const textPart = nextContent[0];
    nextContent[0] = {
      ...textPart,
      text: `${textPart.text}\n\n${warningBlock}`,
    };

    return {
      ...result,
      content: nextContent,
    };
  } catch {
    return result;
  }
}

async function createMcpServer(): Promise<McpServer> {
  const projectId = getProjectId();

  const server = new McpServer({
    name: "memories",
    version: CLI_VERSION,
  });

  // ─── Resources ───────────────────────────────────────────────────

  // Resource: memories://rules — all active rules as markdown
  server.resource(
    "rules",
    "memories://rules",
    { description: "All active rules (coding standards, preferences, constraints)", mimeType: "text/markdown" },
    async () => {
      try {
        const rules = await getRules({ projectId: projectId ?? undefined });

        if (rules.length === 0) {
          return {
            contents: [{ uri: "memories://rules", mimeType: "text/markdown", text: "No rules defined." }],
          };
        }

        const globalRules = rules.filter((r) => r.scope === "global");
        const projectRules = rules.filter((r) => r.scope === "project");

        const parts: string[] = [];
        if (globalRules.length > 0) {
          parts.push(`## Global Rules\n\n${globalRules.map((r) => `- ${r.content}`).join("\n")}`);
        }
        if (projectRules.length > 0) {
          parts.push(`## Project Rules\n\n${projectRules.map((r) => `- ${r.content}`).join("\n")}`);
        }

        return {
          contents: [{ uri: "memories://rules", mimeType: "text/markdown", text: parts.join("\n\n") }],
        };
      } catch (error) {
        return {
          contents: [{ uri: "memories://rules", mimeType: "text/markdown", text: `Error loading rules: ${error instanceof Error ? error.message : "Unknown error"}` }],
        };
      }
    }
  );

  // Resource: memories://recent — 20 most recent memories
  server.resource(
    "recent",
    "memories://recent",
    { description: "20 most recent memories across all types", mimeType: "text/markdown" },
    async () => {
      try {
        const memories = await listMemories({
          limit: 20,
          projectId: projectId ?? undefined,
        });

        if (memories.length === 0) {
          return {
            contents: [{ uri: "memories://recent", mimeType: "text/markdown", text: "No memories found." }],
          };
        }

        const text = memories.map(formatMemory).join("\n");
        return {
          contents: [{ uri: "memories://recent", mimeType: "text/markdown", text: `## Recent Memories\n\n${text}` }],
        };
      } catch (error) {
        return {
          contents: [{ uri: "memories://recent", mimeType: "text/markdown", text: `Error loading memories: ${error instanceof Error ? error.message : "Unknown error"}` }],
        };
      }
    }
  );

  // Resource template: memories://project/{projectId} — memories for a specific project
  server.resource(
    "project-memories",
    new ResourceTemplate("memories://project/{projectId}", { list: undefined }),
    { description: "All memories for a specific project", mimeType: "text/markdown" },
    async (uri, variables) => {
      try {
        const pid = String(variables.projectId);
        const memories = await listMemories({
          projectId: pid,
          includeGlobal: false,
        });

        if (memories.length === 0) {
          return {
            contents: [{ uri: uri.href, mimeType: "text/markdown", text: `No memories found for project ${pid}.` }],
          };
        }

        const text = memories.map(formatMemory).join("\n");
        return {
          contents: [{ uri: uri.href, mimeType: "text/markdown", text: `## Memories for ${pid}\n\n${text}` }],
        };
      } catch (error) {
        return {
          contents: [{ uri: uri.href, mimeType: "text/markdown", text: `Error loading project memories: ${error instanceof Error ? error.message : "Unknown error"}` }],
        };
      }
    }
  );

  // ─── Tools ───────────────────────────────────────────────────────

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

  // ─── Streaming Memory Tools ─────────────────────────────────────────────────
  // For collecting content from SSE streams (v0, etc.) and embedding on completion

  // Tool: start_memory_stream
  server.tool(
    "start_memory_stream",
    `Start collecting content from an SSE stream (like v0, Claude artifacts, etc.).
Returns a stream ID that you'll use to append chunks and finalize the memory.

Use this when you're receiving content in chunks via Server-Sent Events:
1. Call start_memory_stream to get a stream_id
2. Call append_memory_chunk for each chunk as it arrives
3. Call finalize_memory_stream when done - this creates the memory and generates embeddings`,
    {
      type: z.enum(["rule", "decision", "fact", "note", "skill"]).optional().describe("Memory type (default: note)"),
      tags: z.array(z.string()).optional().describe("Tags to categorize the memory"),
      global: z.boolean().optional().describe("Store as global memory instead of project-scoped"),
      project_id: z.string().optional().describe("Explicit project id (e.g., github.com/org/repo)"),
    },
    async ({ type, tags, global: isGlobal, project_id }) => {
      try {
        const scopeOpts = resolveMemoryScopeInput({ global: isGlobal, project_id });
        const streamId = startMemoryStream({
          type,
          tags,
          ...scopeOpts,
        });
        return {
          content: [{ 
            type: "text", 
            text: `Started stream ${streamId}. Use append_memory_chunk to add content, then finalize_memory_stream when complete.` 
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to start stream: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: append_memory_chunk
  server.tool(
    "append_memory_chunk",
    `Append a chunk of content to an active stream.
Call this for each piece of content as it arrives from the SSE source.
Chunks are concatenated in order when the stream is finalized.`,
    {
      stream_id: z.string().describe("The stream ID from start_memory_stream"),
      chunk: z.string().describe("The content chunk to append"),
    },
    async ({ stream_id, chunk }) => {
      try {
        appendMemoryChunk(stream_id, chunk);
        const state = getStreamState(stream_id);
        return {
          content: [{ 
            type: "text", 
            text: `Appended chunk (${chunk.length} chars). Stream now has ${state?.chunkCount ?? 0} chunks, ${state?.contentLength ?? 0} total chars.` 
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to append chunk: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: finalize_memory_stream
  server.tool(
    "finalize_memory_stream",
    `Complete a stream and create the memory.
This joins all chunks, creates the memory, and triggers embedding generation.
The stream is cleaned up after finalization.`,
    {
      stream_id: z.string().describe("The stream ID from start_memory_stream"),
    },
    async ({ stream_id }) => {
      try {
        const state = getStreamState(stream_id);
        const memory = await finalizeMemoryStream(stream_id);
        
        if (!memory) {
          return {
            content: [{ type: "text", text: `Stream ${stream_id} was empty - no memory created.` }],
          };
        }
        
        const typeLabel = TYPE_LABELS[memory.type];
        return withStorageWarnings({
          content: [{ 
            type: "text", 
            text: `Created ${typeLabel} ${memory.id} from ${state?.chunkCount ?? 0} chunks (${memory.content.length} chars). Embedding generation started.` 
          }],
        });
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to finalize stream: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: cancel_memory_stream
  server.tool(
    "cancel_memory_stream",
    "Cancel an active stream without creating a memory. Use if the stream is aborted or content should be discarded.",
    {
      stream_id: z.string().describe("The stream ID to cancel"),
    },
    async ({ stream_id }) => {
      try {
        const state = getStreamState(stream_id);
        const cancelled = cancelMemoryStream(stream_id);
        
        if (cancelled) {
          return {
            content: [{ 
              type: "text", 
              text: `Cancelled stream ${stream_id} (discarded ${state?.chunkCount ?? 0} chunks, ${state?.contentLength ?? 0} chars).` 
            }],
          };
        }
        return {
          content: [{ type: "text", text: `Stream ${stream_id} not found or already finalized.` }],
          isError: true,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to cancel stream: ${error instanceof Error ? error.message : "Unknown error"}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function startMcpHttpServer(options: {
  port: number;
  host: string;
  cors?: boolean;
}): Promise<void> {
  const { port, host, cors } = options;
  const server = await createMcpServer();

  // Create a transport that will be reused across requests
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
  });

  // Connect the MCP server to the transport
  await server.connect(transport);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Handle CORS preflight
    if (cors) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${host}:${port}`);

    // Health check
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp" || url.pathname === "/") {
      try {
        // Parse body for POST requests
        let body: unknown = undefined;
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          if (rawBody) {
            body = JSON.parse(rawBody);
          }
        }

        await transport.handleRequest(req, res, body);
      } catch (error) {
        logger.error("Error handling MCP request:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
      return;
    }

    // 404 for unknown paths
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, host);

  // Keep the process alive
  await new Promise(() => {});
}
