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
  type Memory,
  type MemoryType,
} from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";

const TYPE_LABELS: Record<MemoryType, string> = {
  rule: "📌 RULE",
  decision: "💡 DECISION",
  fact: "📋 FACT",
  note: "📝 NOTE",
};

function formatMemory(m: Memory): string {
  const tags = m.tags ? ` [${m.tags}]` : "";
  const scope = m.scope === "global" ? "G" : "P";
  const typeLabel = TYPE_LABELS[m.type] || "📝 NOTE";
  return `${typeLabel} (${scope}) ${m.id}: ${m.content}${tags}`;
}

function formatRulesSection(rules: Memory[]): string {
  if (rules.length === 0) return "";
  return `## Active Rules\n${rules.map(r => `- ${r.content}`).join("\n")}`;
}

function formatMemoriesSection(memories: Memory[], title: string): string {
  if (memories.length === 0) return "";
  return `## ${title}\n${memories.map(formatMemory).join("\n")}`;
}

async function createMcpServer(): Promise<McpServer> {
  const projectId = getProjectId();

  const server = new McpServer({
    name: "memories",
    version: "0.1.0",
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

By default, memories are project-scoped when in a git repo. Use global: true for user-wide preferences.`,
    {
      content: z.string().describe("The memory content to store"),
      type: z.enum(["rule", "decision", "fact", "note"]).optional().describe("Memory type (default: note)"),
      tags: z.array(z.string()).optional().describe("Tags to categorize the memory"),
      global: z.boolean().optional().describe("Store as global memory instead of project-scoped"),
    },
    async ({ content, type, tags, global: isGlobal }) => {
      try {
        const memory = await addMemory(content, { 
          tags, 
          global: isGlobal,
          type: type as MemoryType | undefined,
        });
        const typeLabel = TYPE_LABELS[memory.type];
        return {
          content: [
            {
              type: "text",
              text: `Stored ${typeLabel} ${memory.id} (${memory.scope}${memory.project_id ? `: ${memory.project_id}` : ""})`,
            },
          ],
        };
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
      types: z.array(z.enum(["rule", "decision", "fact", "note"])).optional().describe("Filter by memory types"),
    },
    async ({ query, limit, types }) => {
      try {
        const memories = await searchMemories(query, { 
          limit, 
          projectId: projectId ?? undefined,
          types: types as MemoryType[] | undefined,
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
      types: z.array(z.enum(["rule", "decision", "fact", "note"])).optional().describe("Filter by memory types"),
    },
    async ({ limit, tags, types }) => {
      try {
        const memories = await listMemories({ 
          limit, 
          tags, 
          projectId: projectId ?? undefined,
          types: types as MemoryType[] | undefined,
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
    `Update an existing memory's content, type, or tags. Use this to refine or correct memories.
Find the memory ID first with search_memories or list_memories.`,
    {
      id: z.string().describe("The memory ID to edit"),
      content: z.string().optional().describe("New content for the memory"),
      type: z.enum(["rule", "decision", "fact", "note"]).optional().describe("New type for the memory"),
      tags: z.array(z.string()).optional().describe("New tags (replaces existing tags)"),
    },
    async ({ id, content, type, tags }) => {
      try {
        if (!content && !type && !tags) {
          return {
            content: [{ type: "text", text: "Nothing to update. Provide at least one of: content, type, tags." }],
            isError: true,
          };
        }
        const updated = await updateMemory(id, {
          content,
          type: type as MemoryType | undefined,
          tags,
        });
        if (updated) {
          const typeLabel = TYPE_LABELS[updated.type];
          return {
            content: [{ type: "text", text: `Updated ${typeLabel} ${updated.id}: ${updated.content}` }],
          };
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
          return {
            content: [{ type: "text", text: `Forgot memory ${id}` }],
          };
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
        console.error("[memories] Error handling MCP request:", error);
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
