import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  listMemories,
  getRules,
} from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";
import { setCloudMode } from "../lib/db.js";
import { CLI_VERSION } from "../lib/version.js";
import { formatMemory } from "./formatters.js";
import { registerCoreTools } from "./tools.js";
import { registerStreamingTools } from "./streaming-tools.js";

// Re-export for use by serve command
export function setCloudCredentials(url: string, token: string): void {
  setCloudMode(url, token);
}

// Re-export startMcpHttpServer for serve command
export { startMcpHttpServer } from "./mcp-http.js";
export { withStorageWarnings } from "./formatters.js";

// ─── MCP Server Factory ──────────────────────────────────────────────────────

export async function createMcpServer(): Promise<McpServer> {
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

  registerCoreTools(server, projectId);
  registerStreamingTools(server, projectId);

  return server;
}

// ─── Server Startup ──────────────────────────────────────────────────────────

export async function startMcpServer(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
