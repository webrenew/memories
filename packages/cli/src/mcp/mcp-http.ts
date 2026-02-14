import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { logger } from "../lib/logger.js";
import { createMcpServer } from "./index.js";

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
