import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { getDb } from "./db.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";

const MODEL_NAME = "Xenova/gte-base"; // Good quality GTE embeddings
const EMBEDDING_DIM = 768; // GTE-base produces 768-dim vectors

let embedder: FeatureExtractionPipeline | null = null;
let modelLoading: Promise<FeatureExtractionPipeline> | null = null;

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
  if (embedder) return embedder;
  
  if (modelLoading) return modelLoading;
  
  modelLoading = (async () => {
    const cacheDir = getModelCacheDir();
    
    // Set environment for transformers.js
    process.env.TRANSFORMERS_CACHE = cacheDir;
    
    embedder = await pipeline("feature-extraction", MODEL_NAME, {
      cache_dir: cacheDir,
      quantized: true, // Use quantized model for faster loading
    });
    
    return embedder;
  })();
  
  return modelLoading;
}

/**
 * Generate embedding for text
 */
export async function getEmbedding(text: string): Promise<Float32Array> {
  const model = await getEmbedder();
  
  const output = await model(text, {
    pooling: "mean",
    normalize: true,
  });
  
  // Handle the tensor data conversion
  const data = output.data as unknown as number[] | Float32Array;
  return new Float32Array(data);
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
 * Convert Float32Array to Buffer for SQLite storage
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

/**
 * Convert Buffer back to Float32Array
 */
export function bufferToEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
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
    await db.execute("ALTER TABLE memories ADD COLUMN embedding BLOB");
  }
}

/**
 * Store embedding for a memory
 */
export async function storeEmbedding(memoryId: string, embedding: Float32Array): Promise<void> {
  const db = await getDb();
  await ensureEmbeddingsSchema();
  
  const buffer = embeddingToBuffer(embedding);
  
  await db.execute({
    sql: "UPDATE memories SET embedding = ? WHERE id = ?",
    args: [buffer, memoryId],
  });
}

/**
 * Get embedding for a memory
 */
export async function getStoredEmbedding(memoryId: string): Promise<Float32Array | null> {
  const db = await getDb();
  
  const result = await db.execute({
    sql: "SELECT embedding FROM memories WHERE id = ?",
    args: [memoryId],
  });
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0] as unknown as { embedding: ArrayBuffer | null };
  if (!row.embedding) return null;
  
  return new Float32Array(row.embedding);
}

/**
 * Search memories by semantic similarity
 */
export async function semanticSearch(
  query: string,
  opts?: { limit?: number; threshold?: number; projectId?: string }
): Promise<{ id: string; content: string; score: number }[]> {
  const db = await getDb();
  const limit = opts?.limit ?? 10;
  const threshold = opts?.threshold ?? 0.3; // Minimum similarity score
  
  // Generate query embedding
  const queryEmbedding = await getEmbedding(query);
  
  // Get all memories with embeddings
  let sql = `
    SELECT id, content, embedding, scope, project_id 
    FROM memories 
    WHERE deleted_at IS NULL AND embedding IS NOT NULL
  `;
  const args: string[] = [];
  
  // Filter by project if specified
  if (opts?.projectId) {
    sql += " AND (scope = 'global' OR (scope = 'project' AND project_id = ?))";
    args.push(opts.projectId);
  }
  
  const result = await db.execute({ sql, args });
  
  // Calculate similarity for each memory
  const scored: { id: string; content: string; score: number }[] = [];
  
  for (const row of result.rows) {
    const r = row as unknown as { id: string; content: string; embedding: ArrayBuffer };
    if (!r.embedding) continue;
    
    const memEmbedding = new Float32Array(r.embedding);
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
 * Get embedding dimension
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIM;
}
