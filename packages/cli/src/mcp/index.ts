import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addMemory,
  searchMemories,
  listMemories,
  forgetMemory,
  type Memory,
} from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";

function formatMemory(m: Memory): string {
  const tags = m.tags ? ` [${m.tags}]` : "";
  const scope = m.scope === "global" ? "G" : "P";
  return `${scope} ${m.id}: ${m.content}${tags}`;
}

export async function startMcpServer(): Promise<void> {
  const projectId = getProjectId();

  const server = new McpServer({
    name: "memories",
    version: "0.1.0",
  });

  // Tool: add_memory
  server.tool(
    "add_memory",
    "Store a new memory. By default, memories are project-scoped when in a git repo. Use global: true for user-wide memories (rules, preferences).",
    {
      content: z.string().describe("The memory content to store"),
      tags: z.array(z.string()).optional().describe("Tags to categorize the memory"),
      global: z.boolean().optional().describe("Store as global memory instead of project-scoped"),
    },
    async ({ content, tags, global: isGlobal }) => {
      try {
        const memory = await addMemory(content, { tags, global: isGlobal });
        return {
          content: [
            {
              type: "text",
              text: `Stored memory ${memory.id} (${memory.scope}${memory.project_id ? `: ${memory.project_id}` : ""})`,
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
    "Search memories by content. Returns both global and project-scoped memories.",
    {
      query: z.string().describe("Search query to match against memory content"),
      limit: z.number().optional().describe("Maximum number of results (default: 20)"),
    },
    async ({ query, limit }) => {
      try {
        const memories = await searchMemories(query, { limit, projectId: projectId ?? undefined });

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

  // Tool: list_memories
  server.tool(
    "list_memories",
    "List recent memories. Returns both global and project-scoped memories.",
    {
      limit: z.number().optional().describe("Maximum number of results (default: 50)"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
    },
    async ({ limit, tags }) => {
      try {
        const memories = await listMemories({ limit, tags, projectId: projectId ?? undefined });

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

  // Tool: forget_memory
  server.tool(
    "forget_memory",
    "Soft-delete a memory by ID",
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

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
