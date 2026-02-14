import { nanoid } from "nanoid";
import { addMemory, type AddMemoryOpts, type Memory } from "./memory.js";
import { logger } from "./logger.js";

// ─── Streaming Memory API ────────────────────────────────────────────────────
// For collecting content from SSE streams (v0, etc.) and embedding on completion

/**
 * In-memory store for active streams.
 * Streams are short-lived so we don't need persistence.
 * Map<streamId, StreamState>
 */
interface StreamState {
  id: string;
  chunks: string[];
  opts: AddMemoryOpts;
  createdAt: Date;
  lastChunkAt: Date;
}

const activeStreams = new Map<string, StreamState>();

// Clean up stale streams older than 1 hour
const STREAM_TTL_MS = 60 * 60 * 1000;

function cleanupStaleStreams(): void {
  const now = Date.now();
  for (const [id, stream] of activeStreams) {
    if (now - stream.lastChunkAt.getTime() > STREAM_TTL_MS) {
      activeStreams.delete(id);
      logger.info(`Cleaned up stale stream ${id} (no chunks for 1 hour)`);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupStaleStreams, 5 * 60 * 1000).unref();

/**
 * Start a new memory stream for collecting SSE chunks.
 * Returns a stream ID to use for appending chunks and finalizing.
 */
export function startMemoryStream(opts?: AddMemoryOpts): string {
  const id = nanoid(12);
  const now = new Date();

  activeStreams.set(id, {
    id,
    chunks: [],
    opts: opts ?? {},
    createdAt: now,
    lastChunkAt: now,
  });

  return id;
}

/**
 * Append a chunk of content to an active stream.
 * Throws if stream doesn't exist.
 */
export function appendMemoryChunk(streamId: string, chunk: string): void {
  const stream = activeStreams.get(streamId);
  if (!stream) {
    throw new Error(`Stream ${streamId} not found or expired`);
  }

  stream.chunks.push(chunk);
  stream.lastChunkAt = new Date();
}

/**
 * Get current state of a stream (for debugging/monitoring).
 */
export function getStreamState(streamId: string): {
  exists: boolean;
  chunkCount: number;
  contentLength: number;
  ageMs: number;
} | null {
  const stream = activeStreams.get(streamId);
  if (!stream) return null;

  const content = stream.chunks.join("");
  return {
    exists: true,
    chunkCount: stream.chunks.length,
    contentLength: content.length,
    ageMs: Date.now() - stream.createdAt.getTime(),
  };
}

/**
 * Finalize a stream: join chunks, create memory, trigger embedding.
 * Returns the created memory or null if stream was empty.
 * Cleans up the stream state after completion.
 */
export async function finalizeMemoryStream(streamId: string): Promise<Memory | null> {
  const stream = activeStreams.get(streamId);
  if (!stream) {
    throw new Error(`Stream ${streamId} not found or expired`);
  }

  // Clean up immediately
  activeStreams.delete(streamId);

  // Join all chunks
  const content = stream.chunks.join("");

  // Skip empty streams
  if (!content.trim()) {
    return null;
  }

  // Create the memory (this triggers embedding automatically)
  return addMemory(content, stream.opts);
}

/**
 * Cancel an active stream without creating a memory.
 */
export function cancelMemoryStream(streamId: string): boolean {
  return activeStreams.delete(streamId);
}

/**
 * List all active streams (for debugging).
 */
export function listActiveStreams(): Array<{
  id: string;
  chunkCount: number;
  contentLength: number;
  ageMs: number;
}> {
  const result: Array<{
    id: string;
    chunkCount: number;
    contentLength: number;
    ageMs: number;
  }> = [];

  for (const stream of activeStreams.values()) {
    const content = stream.chunks.join("");
    result.push({
      id: stream.id,
      chunkCount: stream.chunks.length,
      contentLength: content.length,
      ageMs: Date.now() - stream.createdAt.getTime(),
    });
  }

  return result;
}
