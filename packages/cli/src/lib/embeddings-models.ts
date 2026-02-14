// ─── Supported Embedding Models ───────────────────────────────────────────────

/**
 * Supported embedding model configuration
 */
export interface EmbeddingModel {
  id: string;
  name: string;
  dimensions: number;
  description: string;
  speed: "fast" | "medium" | "slow";
  quality: "good" | "better" | "best";
}

/**
 * Available embedding models compatible with transformers.js
 * Ordered by speed (fastest first)
 */
export const EMBEDDING_MODELS: Record<string, EmbeddingModel> = {
  "all-MiniLM-L6-v2": {
    id: "all-MiniLM-L6-v2",
    name: "Xenova/all-MiniLM-L6-v2",
    dimensions: 384,
    description: "Fastest model, good for most use cases",
    speed: "fast",
    quality: "good",
  },
  "gte-small": {
    id: "gte-small",
    name: "Xenova/gte-small",
    dimensions: 384,
    description: "Small GTE model, fast with good quality",
    speed: "fast",
    quality: "good",
  },
  "gte-base": {
    id: "gte-base",
    name: "Xenova/gte-base",
    dimensions: 768,
    description: "Balanced speed and quality",
    speed: "medium",
    quality: "better",
  },
  "gte-large": {
    id: "gte-large",
    name: "Xenova/gte-large",
    dimensions: 1024,
    description: "Highest quality, slower",
    speed: "slow",
    quality: "best",
  },
  "mxbai-embed-large-v1": {
    id: "mxbai-embed-large-v1",
    name: "mixedbread-ai/mxbai-embed-large-v1",
    dimensions: 1024,
    description: "High quality mixedbread model",
    speed: "slow",
    quality: "best",
  },
};

export const DEFAULT_MODEL_ID = "all-MiniLM-L6-v2";

/**
 * Get list of available model IDs
 */
export function getAvailableModels(): EmbeddingModel[] {
  return Object.values(EMBEDDING_MODELS);
}
