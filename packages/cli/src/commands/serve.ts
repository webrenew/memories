import { Command } from "commander";
import { startMcpServer } from "../mcp/index.js";
import { getProjectId } from "../lib/git.js";

export const serveCommand = new Command("serve")
  .description("Start the MCP server (stdio transport)")
  .action(async () => {
    const projectId = getProjectId();
    
    // Log to stderr so it doesn't interfere with MCP stdio protocol
    if (projectId) {
      console.error(`[memories] MCP server starting (project: ${projectId})`);
    } else {
      console.error("[memories] MCP server starting (global only - not in a git repo)");
    }
    
    await startMcpServer();
  });
