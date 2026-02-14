import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

// Use a temp directory so tests never hit sync
process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-stream-test-"));

import {
  startMemoryStream,
  appendMemoryChunk,
  finalizeMemoryStream,
  cancelMemoryStream,
  getStreamState,
  listActiveStreams,
} from "./memory.js";

describe("streaming memory API", () => {
  describe("startMemoryStream", () => {
    it("should return a stream ID", () => {
      const streamId = startMemoryStream();
      expect(streamId).toBeDefined();
      expect(typeof streamId).toBe("string");
      expect(streamId.length).toBe(12); // nanoid(12)
    });

    it("should create an empty stream state", () => {
      const streamId = startMemoryStream();
      const state = getStreamState(streamId);
      
      expect(state).not.toBeNull();
      expect(state?.exists).toBe(true);
      expect(state?.chunkCount).toBe(0);
      expect(state?.contentLength).toBe(0);
      expect(state?.ageMs).toBeGreaterThanOrEqual(0);
    });

    it("should store options for later use", async () => {
      const streamId = startMemoryStream({ 
        type: "decision", 
        tags: ["test", "streaming"],
        global: true,
      });
      
      // Append some content and finalize to check options are applied
      appendMemoryChunk(streamId, "Test decision content");
      const memory = await finalizeMemoryStream(streamId);
      
      expect(memory).not.toBeNull();
      expect(memory?.type).toBe("decision");
      expect(memory?.tags).toBe("test,streaming");
      expect(memory?.scope).toBe("global");
    });
  });

  describe("appendMemoryChunk", () => {
    it("should append chunks to stream", () => {
      const streamId = startMemoryStream();
      
      appendMemoryChunk(streamId, "Hello ");
      let state = getStreamState(streamId);
      expect(state?.chunkCount).toBe(1);
      expect(state?.contentLength).toBe(6);
      
      appendMemoryChunk(streamId, "World!");
      state = getStreamState(streamId);
      expect(state?.chunkCount).toBe(2);
      expect(state?.contentLength).toBe(12);
    });

    it("should throw for non-existent stream", () => {
      expect(() => appendMemoryChunk("nonexistent", "chunk")).toThrow(
        "Stream nonexistent not found or expired"
      );
    });

    it("should handle empty chunks", () => {
      const streamId = startMemoryStream();
      appendMemoryChunk(streamId, "");
      const state = getStreamState(streamId);
      expect(state?.chunkCount).toBe(1);
      expect(state?.contentLength).toBe(0);
    });
  });

  describe("finalizeMemoryStream", () => {
    it("should create memory from chunks", async () => {
      const streamId = startMemoryStream({ type: "fact" });
      
      appendMemoryChunk(streamId, "The ");
      appendMemoryChunk(streamId, "API ");
      appendMemoryChunk(streamId, "rate limit is 100/min.");
      
      const memory = await finalizeMemoryStream(streamId);
      
      expect(memory).not.toBeNull();
      expect(memory?.content).toBe("The API rate limit is 100/min.");
      expect(memory?.type).toBe("fact");
    });

    it("should return null for empty stream", async () => {
      const streamId = startMemoryStream();
      const memory = await finalizeMemoryStream(streamId);
      expect(memory).toBeNull();
    });

    it("should return null for whitespace-only stream", async () => {
      const streamId = startMemoryStream();
      appendMemoryChunk(streamId, "   ");
      appendMemoryChunk(streamId, "\n\t");
      const memory = await finalizeMemoryStream(streamId);
      expect(memory).toBeNull();
    });

    it("should clean up stream after finalization", async () => {
      const streamId = startMemoryStream();
      appendMemoryChunk(streamId, "content");
      await finalizeMemoryStream(streamId);
      
      const state = getStreamState(streamId);
      expect(state).toBeNull();
    });

    it("should throw for non-existent stream", async () => {
      await expect(finalizeMemoryStream("nonexistent")).rejects.toThrow(
        "Stream nonexistent not found or expired"
      );
    });

    it("should throw for already finalized stream", async () => {
      const streamId = startMemoryStream();
      appendMemoryChunk(streamId, "content");
      await finalizeMemoryStream(streamId);
      
      await expect(finalizeMemoryStream(streamId)).rejects.toThrow(
        `Stream ${streamId} not found or expired`
      );
    });
  });

  describe("cancelMemoryStream", () => {
    it("should cancel active stream", () => {
      const streamId = startMemoryStream();
      appendMemoryChunk(streamId, "some content");
      
      const cancelled = cancelMemoryStream(streamId);
      
      expect(cancelled).toBe(true);
      expect(getStreamState(streamId)).toBeNull();
    });

    it("should return false for non-existent stream", () => {
      const cancelled = cancelMemoryStream("nonexistent");
      expect(cancelled).toBe(false);
    });
  });

  describe("getStreamState", () => {
    it("should return null for non-existent stream", () => {
      const state = getStreamState("nonexistent");
      expect(state).toBeNull();
    });

    it("should track age correctly", async () => {
      const streamId = startMemoryStream();
      const state1 = getStreamState(streamId);
      
      // Wait a bit
      await delay(50);
      
      const state2 = getStreamState(streamId);
      expect(state2?.ageMs).toBeGreaterThan(state1?.ageMs ?? 0);
      
      // Clean up
      cancelMemoryStream(streamId);
    });
  });

  describe("listActiveStreams", () => {
    it("should list all active streams", () => {
      const id1 = startMemoryStream();
      const id2 = startMemoryStream();
      
      appendMemoryChunk(id1, "content 1");
      appendMemoryChunk(id2, "content 2 longer");
      
      const streams = listActiveStreams();
      const streamIds = streams.map(s => s.id);
      
      expect(streamIds).toContain(id1);
      expect(streamIds).toContain(id2);
      
      // Clean up
      cancelMemoryStream(id1);
      cancelMemoryStream(id2);
    });
  });

  describe("SSE simulation", () => {
    it("should handle typical SSE flow from v0", async () => {
      // Simulate v0 streaming a React component
      const streamId = startMemoryStream({ 
        type: "note", 
        tags: ["v0", "component"] 
      });
      
      // Simulate SSE chunks arriving
      const chunks = [
        "export function Button",
        "({ children, onClick }:",
        " ButtonProps) {\n",
        "  return (\n",
        "    <button onClick={onClick}>\n",
        "      {children}\n",
        "    </button>\n",
        "  );\n",
        "}",
      ];
      
      for (const chunk of chunks) {
        appendMemoryChunk(streamId, chunk);
      }
      
      const memory = await finalizeMemoryStream(streamId);
      
      expect(memory).not.toBeNull();
      expect(memory?.content).toBe(chunks.join(""));
      expect(memory?.tags).toBe("v0,component");
    });

    it("should handle stream cancellation mid-flow", () => {
      const streamId = startMemoryStream();
      
      appendMemoryChunk(streamId, "partial ");
      appendMemoryChunk(streamId, "content");
      
      // Simulate SSE error/abort
      const cancelled = cancelMemoryStream(streamId);
      
      expect(cancelled).toBe(true);
      expect(getStreamState(streamId)).toBeNull();
    });
  });
});
