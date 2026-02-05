import { describe, it, expect, beforeAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Use a temp directory so tests never hit sync
process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-embed-test-"));

import {
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding,
  EmbeddingError,
  getEmbeddingDimension,
  getAvailableModels,
  getCurrentModelInfo,
  setEmbeddingModel,
  DEFAULT_MODEL_ID,
  EMBEDDING_MODELS,
} from "./embeddings.js";

describe("embeddings", () => {
  describe("EmbeddingError", () => {
    it("should create error with message", () => {
      const error = new EmbeddingError("test error");
      expect(error.message).toBe("test error");
      expect(error.name).toBe("EmbeddingError");
      expect(error.cause).toBeUndefined();
    });

    it("should create error with cause", () => {
      const cause = new Error("original error");
      const error = new EmbeddingError("wrapped error", cause);
      expect(error.message).toBe("wrapped error");
      expect(error.cause).toBe(cause);
    });
  });

  describe("model configuration", () => {
    it("should have default model as all-MiniLM-L6-v2 (fastest)", () => {
      expect(DEFAULT_MODEL_ID).toBe("all-MiniLM-L6-v2");
    });

    it("should return available models", () => {
      const models = getAvailableModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === "all-MiniLM-L6-v2")).toBe(true);
      expect(models.some(m => m.id === "gte-base")).toBe(true);
      expect(models.some(m => m.id === "gte-large")).toBe(true);
    });

    it("should have correct dimensions for each model", () => {
      expect(EMBEDDING_MODELS["all-MiniLM-L6-v2"].dimensions).toBe(384);
      expect(EMBEDDING_MODELS["gte-small"].dimensions).toBe(384);
      expect(EMBEDDING_MODELS["gte-base"].dimensions).toBe(768);
      expect(EMBEDDING_MODELS["gte-large"].dimensions).toBe(1024);
    });

    it("should get current model info", () => {
      const model = getCurrentModelInfo();
      expect(model).toBeDefined();
      expect(model.id).toBeDefined();
      expect(model.dimensions).toBeGreaterThan(0);
    });

    it("should throw for unknown model", () => {
      expect(() => setEmbeddingModel("unknown-model")).toThrow(EmbeddingError);
    });

    it("should detect dimension change when switching models", () => {
      // Set to a known model first
      setEmbeddingModel("all-MiniLM-L6-v2"); // 384d
      
      // Switch to different dimension model
      const result = setEmbeddingModel("gte-base"); // 768d
      
      expect(result.dimensionChanged).toBe(true);
      expect(result.previousDimensions).toBe(384);
      expect(result.model.dimensions).toBe(768);
      
      // Reset to default for other tests
      setEmbeddingModel(DEFAULT_MODEL_ID);
    });
  });

  describe("cosineSimilarity", () => {
    it("should return 1 for identical normalized vectors", () => {
      const a = new Float32Array([0.6, 0.8, 0]);
      const b = new Float32Array([0.6, 0.8, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    it("should return 0 for orthogonal vectors", () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it("should return -1 for opposite vectors", () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    it("should return 0 for mismatched lengths", () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([1, 0]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it("should return 0 for zero vectors", () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it("should handle non-normalized vectors correctly", () => {
      const a = new Float32Array([3, 4, 0]); // magnitude = 5
      const b = new Float32Array([6, 8, 0]); // magnitude = 10, same direction
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });
  });

  describe("embeddingToBuffer / bufferToEmbedding round-trip", () => {
    it("should correctly round-trip a Float32Array", () => {
      const original = new Float32Array([1.5, -2.3, 0.0, 3.14159, -0.001]);
      const buffer = embeddingToBuffer(original);
      const restored = bufferToEmbedding(buffer);

      expect(restored.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });

    it("should handle embeddings at current model dimension", () => {
      const dim = getEmbeddingDimension();
      expect(dim).toBeGreaterThan(0);

      const original = new Float32Array(dim);
      for (let i = 0; i < dim; i++) {
        original[i] = Math.random() * 2 - 1; // Random values between -1 and 1
      }

      const buffer = embeddingToBuffer(original);
      expect(buffer.length).toBe(dim * 4); // 4 bytes per float32

      const restored = bufferToEmbedding(buffer);
      expect(restored.length).toBe(dim);

      for (let i = 0; i < dim; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });

    it("should handle Float32Array views correctly", () => {
      // Create a larger buffer and a view into it
      const largerBuffer = new ArrayBuffer(100);
      const view = new Float32Array(largerBuffer, 8, 5); // offset of 8 bytes, 5 elements
      view[0] = 1.1;
      view[1] = 2.2;
      view[2] = 3.3;
      view[3] = 4.4;
      view[4] = 5.5;

      const buffer = embeddingToBuffer(view);
      // Should only contain the 5 floats, not the entire largerBuffer
      expect(buffer.length).toBe(5 * 4);

      const restored = bufferToEmbedding(buffer);
      expect(restored.length).toBe(5);
      expect(restored[0]).toBeCloseTo(1.1, 5);
      expect(restored[4]).toBeCloseTo(5.5, 5);
    });
  });

  describe("embedding dimension", () => {
    it("should return dimension matching current model", () => {
      const model = getCurrentModelInfo();
      expect(getEmbeddingDimension()).toBe(model.dimensions);
    });
  });
});

// Integration tests that require the actual model
// These are slower and download the model on first run
describe("embeddings integration", () => {
  // Skip these tests in CI or when SKIP_EMBEDDING_INTEGRATION is set
  const skipIntegration = process.env.CI || process.env.SKIP_EMBEDDING_INTEGRATION;

  it.skipIf(skipIntegration)("should generate valid embeddings", async () => {
    const { getEmbedding, getCurrentModelInfo } = await import("./embeddings.js");
    const model = getCurrentModelInfo();
    
    const embedding = await getEmbedding("Hello, world!");
    
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(model.dimensions);
    
    // Embeddings should be normalized (magnitude ≈ 1)
    let magnitude = 0;
    for (let i = 0; i < embedding.length; i++) {
      magnitude += embedding[i] * embedding[i];
    }
    magnitude = Math.sqrt(magnitude);
    expect(magnitude).toBeCloseTo(1, 2);
  }, 60000); // 60s timeout for model download

  it.skipIf(skipIntegration)("should throw EmbeddingError for empty text", async () => {
    const { getEmbedding } = await import("./embeddings.js");
    
    await expect(getEmbedding("")).rejects.toThrow(EmbeddingError);
    await expect(getEmbedding("   ")).rejects.toThrow(EmbeddingError);
  });

  it.skipIf(skipIntegration)("should produce similar embeddings for similar text", async () => {
    const { getEmbedding } = await import("./embeddings.js");
    
    const e1 = await getEmbedding("The quick brown fox jumps over the lazy dog");
    const e2 = await getEmbedding("A fast brown fox leaps over a sleepy dog");
    const e3 = await getEmbedding("Quantum physics experiments with entangled particles");
    
    const sim12 = cosineSimilarity(e1, e2);
    const sim13 = cosineSimilarity(e1, e3);
    
    // Similar sentences should have higher similarity than unrelated ones
    expect(sim12).toBeGreaterThan(sim13);
    expect(sim12).toBeGreaterThan(0.5); // Adjusted - threshold depends on model
    expect(sim13).toBeLessThan(0.5); // Unrelated sentences
  }, 60000);
});
