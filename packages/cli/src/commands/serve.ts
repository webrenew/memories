import { Command } from "commander";
import { startMcpServer, startMcpHttpServer, setCloudCredentials } from "../mcp/index.js";
import { getProjectId } from "../lib/git.js";
import { logger } from "../lib/logger.js";
import { getApiUrl } from "../lib/env.js";

const MEMORIES_API = getApiUrl();

interface CloudCredentials {
  turso_db_url: string;
  turso_db_token: string;
}

async function fetchCloudCredentials(apiKey: string): Promise<CloudCredentials> {
  const res = await fetch(`${MEMORIES_API}/api/db/credentials`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch credentials: ${res.status} ${text}`);
  }

  const data = await res.json() as CloudCredentials;

  if (!data.turso_db_url || !data.turso_db_token) {
    throw new Error("Database not provisioned. Visit https://memories.sh/app to set up your account.");
  }

  return data;
}

export const serveCommand = new Command("serve")
  .description("Start the MCP server")
  .option("--api-key <key>", "API key for cloud database (from memories.sh dashboard)")
  .option("--sse", "Use SSE/HTTP transport instead of stdio (for web clients like v0)")
  .option("-p, --port <port>", "Port for SSE server", "3030")
  .option("--host <host>", "Host to bind to", "127.0.0.1")
  .option("--cors", "Enable CORS for cross-origin requests")
  .action(async (opts: { apiKey?: string; sse?: boolean; port?: string; host?: string; cors?: boolean }) => {
    const projectId = getProjectId();

    // If API key provided, fetch cloud credentials
    if (opts.apiKey) {
      try {
        logger.info("Connecting to cloud database...");
        const creds = await fetchCloudCredentials(opts.apiKey);
        setCloudCredentials(creds.turso_db_url, creds.turso_db_token);
        logger.info("Connected to cloud database");
      } catch (error) {
        logger.error(error instanceof Error ? error.message : "Unknown error");
        process.exit(1);
      }
    }

    if (opts.sse) {
      const port = parseInt(opts.port || "3030", 10);
      const host = opts.host || "127.0.0.1";

      logger.info(`Starting MCP server with SSE transport`);
      logger.info(`Listening on http://${host}:${port}`);
      if (projectId) {
        logger.info(`Project: ${projectId}`);
      } else {
        logger.info(`Global only (not in a git repo)`);
      }
      if (opts.cors) {
        logger.info(`CORS enabled`);
      }
      logger.info(`Connect v0 or other clients to: http://${host}:${port}/mcp`);

      await startMcpHttpServer({ port, host, cors: opts.cors });
    } else {
      // Log to stderr so it doesn't interfere with MCP stdio protocol
      if (projectId) {
        logger.info(`MCP server starting (project: ${projectId})`);
      } else {
        logger.info("MCP server starting (global only - not in a git repo)");
      }

      await startMcpServer();
    }
  });
