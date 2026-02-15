import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { getDb, getConfigDir } from "./db.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { MemoryType } from "./memory.js";
import {
  type EmbeddingModel,
  EMBEDDING_MODELS,
  DEFAULT_MODEL_ID,
} from "./embeddings-models.js";

// Re-export for backward compatibility
export { type EmbeddingModel, EMBEDDING_MODELS, DEFAULT_MODEL_ID, getAvailableModels } from "./embeddings-models.js";

// ─── Model Configuration Persistence ──────────────────────────────────────────

interface EmbeddingConfig {
  modelId: string;
  modelName: string;
  dimensions: number;
}

function getEmbeddingConfigPath(): string {
  return join(getConfigDir(), "embedding-model.json");
}

/**
 * Get the currently configured embedding model
 */
function getConfiguredModel(): EmbeddingModel {
  const configPath = getEmbeddingConfigPath();
  
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8")) as EmbeddingConfig;
      const model = EMBEDDING_MODELS[config.modelId];
      if (model) return model;
    } catch {
      // Fall through to default
    }
  }
  
  return EMBEDDING_MODELS[DEFAULT_MODEL_ID];
}

/**
 * Set the embedding model to use.
 * Returns info about whether existing embeddings need to be regenerated.
 */
export function setEmbeddingModel(modelId: string): { 
  model: EmbeddingModel; 
  dimensionChanged: boolean;
  previousDimensions: number;
} {
  const model = EMBEDDING_MODELS[modelId];
  if (!model) {
    throw new EmbeddingError(`Unknown model: ${modelId}. Available: ${Object.keys(EMBEDDING_MODELS).join(", ")}`);
  }
  
  const previous = getConfiguredModel();
  const dimensionChanged = previous.dimensions !== model.dimensions;
  
  const config: EmbeddingConfig = {
    modelId: model.id,
    modelName: model.name,
    dimensions: model.dimensions,
  };
  
  // Ensure config dir exists
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  writeFileSync(getEmbeddingConfigPath(), JSON.stringify(config, null, 2));
  
  // Reset cached embedder so next call loads new model
  resetEmbedder();
  
  return { model, dimensionChanged, previousDimensions: previous.dimensions };
}

// ─── Embedder Instance Management ─────────────────────────────────────────────

let embedder: FeatureExtractionPipeline | null = null;
let modelLoading: Promise<FeatureExtractionPipeline> | null = null;
let currentModelId: string | null = null;

/**
 * Reset the cached embedder (used when model changes)
 */
function resetEmbedder(): void {
  embedder = null;
  modelLoading = null;
  currentModelId = null;
}

/**
 * Embedding-specific error for typed error handling
 */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Get the cache directory for models
 */
function getModelCacheDir(): string {
  const cacheDir = join(homedir(), ".cache", "memories", "models");
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

/**
 * Initialize the embedding model (lazy loading)
 */
async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  const model = getConfiguredModel();
  
  // If model changed, reset
  if (currentModelId && currentModelId !== model.id) {
    resetEmbedder();
  }
  
  if (embedder) return embedder;
  
  if (modelLoading) return modelLoading;
  
  modelLoading = (async () => {
    const cacheDir = getModelCacheDir();
    
    // Set environment for transformers.js
    process.env.TRANSFORMERS_CACHE = cacheDir;
    
    embedder = await pipeline("feature-extraction", model.name, {
      cache_dir: cacheDir,
      quantized: true, // Use quantized model for faster loading
    });
    
    currentModelId = model.id;
    
    return embedder;
  })();
  
  return modelLoading;
}

/**
 * Generate embedding for text
 */
export async function getEmbedding(text: string): Promise<Float32Array> {
  if (!text || text.trim().length === 0) {
    throw new EmbeddingError("Cannot generate embedding for empty text");
  }

  const model = getConfiguredModel();

  try {
    const embedderInstance = await getEmbedder();
    
    const output = await embedderInstance(text, {
      pooling: "mean",
      normalize: true,
    });
    
    // Handle the tensor data conversion
    const data = output.data as unknown as number[] | Float32Array;
    const embedding = new Float32Array(data);
    
    // Validate embedding dimension
    if (embedding.length !== model.dimensions) {
      throw new EmbeddingError(
        `Unexpected embedding dimension: expected ${model.dimensions}, got ${embedding.length}`
      );
    }
    
    return embedding;
  } catch (error) {
    if (error instanceof EmbeddingError) throw error;
    throw new EmbeddingError("Failed to generate embedding", error);
  }
}

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Convert Float32Array to Buffer for SQLite storage.
 * Creates a proper copy to avoid issues with ArrayBuffer views.
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  // Use slice() to ensure we get a clean copy of just the embedding data
  return Buffer.from(embedding.buffer.slice(
    embedding.byteOffset,
    embedding.byteOffset + embedding.byteLength
  ));
}

/**
 * Convert Buffer back to Float32Array.
 * Handles proper byte alignment for Float32Array.
 */
export function bufferToEmbedding(buffer: Buffer): Float32Array {
  // Create a properly aligned Float32Array from the buffer
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  return new Float32Array(arrayBuffer);
}

/**
 * Ensure embeddings column exists in memories table
 */
export async function ensureEmbeddingsSchema(): Promise<void> {
  const db = await getDb();
  
  // Check if column exists
  const tableInfo = await db.execute("PRAGMA table_info(memories)");
  const columns = tableInfo.rows as unknown as { name: string }[];
  const hasEmbedding = columns.some(c => c.name === "embedding");
  
  if (!hasEmbedding) {
    try {
      await db.execute("ALTER TABLE memories ADD COLUMN embedding BLOB");
    } catch (error) {
      // Concurrent callers may race and one will see a duplicate-column error.
      if (
        !(error instanceof Error) ||
        !error.message.toLowerCase().includes("duplicate column name: embedding")
      ) {
        throw error;
      }
    }
  }
}

/**
 * Store embedding for a memory
 */
export async function storeEmbedding(memoryId: string, embedding: Float32Array): Promise<void> {
  const db = await getDb();
  await ensureEmbeddingsSchema();
  
  const buffer = embeddingToBuffer(embedding);
  const model = getConfiguredModel();
  
  // Validate buffer size matches expected embedding size
  const expectedBytes = model.dimensions * 4; // 4 bytes per float32
  if (buffer.length !== expectedBytes) {
    throw new EmbeddingError(
      `Invalid embedding buffer size: expected ${expectedBytes} bytes, got ${buffer.length}`
    );
  }
  
  await db.execute({
    sql: "UPDATE memories SET embedding = ? WHERE id = ?",
    args: [buffer, memoryId],
  });
}

/**
 * Search memories by semantic similarity
 */
export async function semanticSearch(
  query: string,
  opts?: {
    limit?: number;
    threshold?: number;
    projectId?: string;
    includeGlobal?: boolean;
    globalOnly?: boolean;
    types?: MemoryType[];
  }
): Promise<{ id: string; content: string; score: number }[]> {
  const db = await getDb();
  const limit = opts?.limit ?? 10;
  const threshold = opts?.threshold ?? 0.3; // Minimum similarity score
  const includeGlobal = opts?.includeGlobal ?? true;
  const projectId = opts?.globalOnly ? undefined : opts?.projectId;
  
  // Generate query embedding
  const queryEmbedding = await getEmbedding(query);
  
  // Get all memories with embeddings
  let sql = `
    SELECT id, content, embedding
    FROM memories 
    WHERE deleted_at IS NULL AND embedding IS NOT NULL
  `;
  const args: string[] = [];

  const scopeConditions: string[] = [];
  if (includeGlobal) {
    scopeConditions.push("scope = 'global'");
  }
  if (projectId) {
    scopeConditions.push("(scope = 'project' AND project_id = ?)");
    args.push(projectId);
  }
  if (scopeConditions.length === 0) {
    return [];
  }
  sql += ` AND (${scopeConditions.join(" OR ")})`;
  
  if (opts?.types?.length) {
    const placeholders = opts.types.map(() => "?").join(", ");
    sql += ` AND type IN (${placeholders})`;
    args.push(...opts.types);
  }
  
  const result = await db.execute({ sql, args });
  
  // Calculate similarity for each memory
  const scored: { id: string; content: string; score: number }[] = [];
  
  for (const row of result.rows) {
    const r = row as unknown as { id: string; content: string; embedding: ArrayBuffer };
    if (!r.embedding) continue;
    
    // Use bufferToEmbedding for consistent conversion
    const memEmbedding = bufferToEmbedding(Buffer.from(r.embedding));
    const score = cosineSimilarity(queryEmbedding, memEmbedding);
    
    if (score >= threshold) {
      scored.push({ id: r.id, content: r.content, score });
    }
  }
  
  // Sort by similarity and limit
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Check if model is available/loaded
 */
export async function isModelAvailable(): Promise<boolean> {
  try {
    await getEmbedder();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get embedding dimension for the current model
 */
export function getEmbeddingDimension(): number {
  return getConfiguredModel().dimensions;
}

/**
 * Get current model info
 */
export function getCurrentModelInfo(): EmbeddingModel {
  return getConfiguredModel();
}

/**
 * Clear all embeddings (useful when changing models with different dimensions)
 */
export async function clearAllEmbeddings(): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "UPDATE memories SET embedding = NULL WHERE embedding IS NOT NULL"
  );
  return result.rowsAffected;
}
