import { describe, it, expect } from "vitest";
import { EMBEDDING_MODELS, DEFAULT_MODEL_ID, getAvailableModels } from "./embeddings-models.js";

describe("EMBEDDING_MODELS", () => {
  it("has at least 3 models", () => {
    expect(Object.keys(EMBEDDING_MODELS).length).toBeGreaterThanOrEqual(3);
  });

  it("each model has required fields", () => {
    for (const model of Object.values(EMBEDDING_MODELS)) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.dimensions).toBeGreaterThan(0);
      expect(model.description).toBeTruthy();
      expect(["fast", "medium", "slow"]).toContain(model.speed);
      expect(["good", "better", "best"]).toContain(model.quality);
    }
  });

  it("default model ID exists in registry", () => {
    expect(EMBEDDING_MODELS[DEFAULT_MODEL_ID]).toBeDefined();
  });
});

describe("getAvailableModels", () => {
  it("returns array of all models", () => {
    const models = getAvailableModels();
    expect(models.length).toBe(Object.keys(EMBEDDING_MODELS).length);
  });
});
