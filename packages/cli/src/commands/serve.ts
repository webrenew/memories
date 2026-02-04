import { Command } from "commander";
import { startMcpServer, startMcpHttpServer } from "../mcp/index.js";
import { getProjectId } from "../lib/git.js";

export const serveCommand = new Command("serve")
  .description("Start the MCP server")
  .option("--sse", "Use SSE/HTTP transport instead of stdio (for web clients like v0)")
  .option("-p, --port <port>", "Port for SSE server", "3030")
  .option("--host <host>", "Host to bind to", "127.0.0.1")
  .option("--cors", "Enable CORS for cross-origin requests")
  .action(async (opts: { sse?: boolean; port?: string; host?: string; cors?: boolean }) => {
    const projectId = getProjectId();
    
    if (opts.sse) {
      const port = parseInt(opts.port || "3030", 10);
      const host = opts.host || "127.0.0.1";
      
      console.log(`[memories] Starting MCP server with SSE transport`);
      console.log(`[memories] Listening on http://${host}:${port}`);
      if (projectId) {
        console.log(`[memories] Project: ${projectId}`);
      } else {
        console.log(`[memories] Global only (not in a git repo)`);
      }
      if (opts.cors) {
        console.log(`[memories] CORS enabled`);
      }
      console.log(`[memories] Connect v0 or other clients to: http://${host}:${port}/mcp`);
      
      await startMcpHttpServer({ port, host, cors: opts.cors });
    } else {
      // Log to stderr so it doesn't interfere with MCP stdio protocol
      if (projectId) {
        console.error(`[memories] MCP server starting (project: ${projectId})`);
      } else {
        console.error("[memories] MCP server starting (global only - not in a git repo)");
      }
      
      await startMcpServer();
    }
  });
