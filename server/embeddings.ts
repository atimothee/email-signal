/// <reference types="node" />

/**
 * Thin embeddings layer over the OpenAI API. One place to own the model, the
 * batching, and the vector math so callers (vector dedup, and later a semantic
 * clutter cache) stay simple.
 *
 * Vectors are L2-normalized on the way out, so cosine similarity reduces to a
 * dot product everywhere downstream.
 *
 * Like the rest of the Redis layer this is best-effort from the caller's side:
 * if a key is missing or the API errors, embedTexts throws and the caller is
 * expected to fall back to its non-embedding path.
 */

const EMBED_MODEL = process.env['EMAIL_SIGNAL_EMBED_MODEL'] ?? 'text-embedding-3-small';

/** Resolve the key the same way ensureKey() does in agents.ts. */
function resolveKey(override?: string): string {
  const key = override?.trim() || process.env['OPENAI_API_KEY'];
  if (!key) throw new Error('No OpenAI API key for embeddings');
  return key;
}

export function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** Dot product. Assumes both vectors are already L2-normalized (== cosine). */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}

/**
 * Embed many texts in ONE API call (batching is the cost lever) and return
 * unit-normalized vectors in input order. Throws on any failure.
 */
export async function embedTexts(texts: string[], apiKey?: string): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: resolveKey(apiKey) });
  const res = await client.embeddings.create({ model: EMBED_MODEL, input: texts });
  // The API returns data in request order, but sort by index to be safe.
  const sorted = [...res.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => l2normalize(d.embedding as number[]));
}

export const EMBED = { model: EMBED_MODEL };
