import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  startMemoryStream,
  appendMemoryChunk,
  finalizeMemoryStream,
  cancelMemoryStream,
  getStreamState,
} from "../lib/memory.js";
import { resolveMemoryScopeInput } from "./scope.js";
import { TYPE_LABELS, withStorageWarnings } from "./formatters.js";

// ─── Streaming Tool Registrations ─────────────────────────────────────────────

export function registerStreamingTools(server: McpServer, projectId: string | null): void {
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
}
