export function decodeEmbeddingBlob(value: unknown): Float32Array | null {
  let bytes: Uint8Array | null = null
  if (value instanceof Uint8Array) {
    bytes = value
  } else if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value)
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  } else if (Array.isArray(value)) {
    bytes = new Uint8Array(value.map((item) => Number(item) & 0xff))
  }

  if (!bytes || bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) {
    return null
  }

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Float32Array(buffer)
}

export function cosineSimilarity(sourceEmbedding: number[], candidateEmbedding: Float32Array): number {
  if (sourceEmbedding.length !== candidateEmbedding.length || sourceEmbedding.length === 0) {
    return -1
  }

  let dot = 0
  let sourceNorm = 0
  let candidateNorm = 0

  for (let index = 0; index < sourceEmbedding.length; index += 1) {
    const sourceValue = sourceEmbedding[index]
    const candidateValue = candidateEmbedding[index]
    dot += sourceValue * candidateValue
    sourceNorm += sourceValue * sourceValue
    candidateNorm += candidateValue * candidateValue
  }

  if (sourceNorm <= 0 || candidateNorm <= 0) {
    return -1
  }

  return dot / Math.sqrt(sourceNorm * candidateNorm)
}
