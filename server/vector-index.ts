/// <reference types="node" />
import { createHash } from 'node:crypto';
import { EMBED } from './embeddings.js';

/**
 * Best-effort RediSearch vector index — the OSS stand-in for Redis Iris'
 * **Context Retriever**. Stores L2-normalized decision (and, via the generic
 * index below, memory) vectors in Redis and answers KNN queries so agents can
 * reason over prior context instead of re-deriving it every scan.
 *
 * Two indexes are defined, both built on one generic core (`VectorIndex`):
 *   - `decisionIndex`  — synthesized decisions  (#33/#34)
 *   - `memoryIndex`    — MemoryRecord summaries  (#35)
 *
 * Degradation (the core invariant): `REDIS_URL` must point at a Redis with the
 * search module (Redis Stack, or Redis 8+ which bundles it). If REDIS_URL is
 * unset, unreachable, OR the search module is absent, every export here is a
 * silent no-op — `searchDecisions`/`searchMemories` return `[]`, upserts
 * resolve, and nothing throws on the request path. The index is a pure
 * enhancement, never a dependency. Same posture as `server/cache.ts`.
 *
 * Privacy & isolation (matches cache.ts / memory.ts): keys are namespaced by a
 * hashed account, every query filters by the `account` TAG so accounts never
 * mix, and ONLY derived fields (titles, summaries, kinds, urgency, ids) plus the
 * vector are stored — NEVER raw email bodies.
 */

/** Dimensionality + metric are read from the single embeddings constant. */
const DIM = EMBED.dim;
/** TTL on each vector so a derived, regenerated-each-scan index can't grow
 *  unbounded. Mirrors the classify cache default (7 days). */
const TTL_SEC = Number(process.env['EMAIL_SIGNAL_CACHE_TTL_SEC'] ?? 7 * 24 * 60 * 60);

type Status = 'disabled' | 'connecting' | 'connected' | 'error';

/** The slice of ioredis we use. `call` issues raw FT.* commands. */
type RedisLike = {
  call(command: string, ...args: (string | Buffer | number)[]): Promise<unknown>;
  hset(...args: (string | Buffer | number)[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
};

/** One KNN hit: stored scalar fields (strings) plus id + a 0..1 similarity. */
type VectorHit = { id: string; similarity: number; [field: string]: string | number };

let clientPromise: Promise<RedisLike | null> | null = null;
let status: Status = 'disabled';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Hashed account namespace — identical scheme to cache.ts / memory.ts. */
function accountHash(account: string | undefined): string {
  return account?.trim() ? sha256(account.trim().toLowerCase()).slice(0, 16) : 'anon';
}

/**
 * Lazily connect to Redis, reusing the exact best-effort posture of cache.ts:
 * fail fast, never queue, flip status to error on any connection problem so
 * callers no-op. Returns null when REDIS_URL is unset/unreachable.
 */
function getClient(): Promise<RedisLike | null> {
  if (clientPromise) return clientPromise;
  const url = process.env['REDIS_URL']?.trim();
  if (!url) {
    status = 'disabled';
    clientPromise = Promise.resolve(null);
    return clientPromise;
  }
  status = 'connecting';
  clientPromise = (async () => {
    try {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
      });
      client.on('error', (err: Error) => {
        if (status !== 'error') {
          status = 'error';
          console.warn('[emailsignal-server] redis error; vector index disabled:', err.message);
        }
      });
      await client.connect();
      status = 'connected';
      return client as unknown as RedisLike;
    } catch (err) {
      status = 'error';
      console.warn(
        '[emailsignal-server] redis connect failed; vector index disabled:',
        (err as Error).message
      );
      return null;
    }
  })();
  return clientPromise;
}

/** Encode a JS number[] as a little-endian Float32 Buffer for HSET/PARAMS. */
function toFloat32Buffer(vec: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i] ?? 0, i * 4);
  return buf;
}

// ── Generic vector index ────────────────────────────────────────────────────

/** A scalar field carried alongside the vector (stored + optionally indexed). */
interface FieldSpec {
  name: string;
  /** RediSearch field type for the index schema. TEXT is searchable, TAG exact. */
  type: 'TEXT' | 'TAG' | 'NUMERIC';
}

interface VectorIndexConfig {
  /** FT index name, e.g. `es:idx:decision`. */
  indexName: string;
  /** Hash key prefix, e.g. `es:vec:decision:`. */
  keyPrefix: string;
  /** Non-vector fields to store + index (besides the always-present `account`). */
  fields: FieldSpec[];
}

interface UpsertItem {
  id: string;
  vector: number[];
  /** Derived scalar fields — privacy allowlist enforced by the caller's mapping. */
  fields: Record<string, string | number>;
}

/**
 * One generic best-effort vector index. Each instance owns its FT index + key
 * prefix; `decisionIndex` and `memoryIndex` are the two concrete instances.
 */
class VectorIndex {
  private created = false;
  constructor(private readonly cfg: VectorIndexConfig) {}

  /** Test seam: forget the cached FT.CREATE so a fresh fake client re-creates. */
  resetForTests(): void {
    this.created = false;
  }

  /** Build the `FT.CREATE` schema once. Idempotent: "Index already exists" is fine. */
  private async ensureIndex(client: RedisLike): Promise<boolean> {
    if (this.created) return true;
    const schema: (string | number)[] = [
      this.cfg.indexName,
      'ON', 'HASH',
      'PREFIX', '1', this.cfg.keyPrefix,
      'SCHEMA',
      'account', 'TAG',
    ];
    for (const f of this.cfg.fields) schema.push(f.name, f.type);
    schema.push(
      'vec', 'VECTOR', 'HNSW', '6',
      'TYPE', 'FLOAT32',
      'DIM', String(DIM),
      'DISTANCE_METRIC', 'COSINE'
    );
    try {
      await client.call('FT.CREATE', ...schema);
      this.created = true;
      return true;
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (/index already exists/i.test(msg)) {
        this.created = true;
        return true;
      }
      // Missing search module, or any other FT error → degrade. Treat exactly
      // like an unreachable Redis: flip to error so every op no-ops.
      if (status !== 'error') {
        status = 'error';
        console.warn('[emailsignal-server] FT.CREATE failed; vector index disabled:', msg);
      }
      return false;
    }
  }

  /** Warm the connection + create the index at boot. */
  async init(): Promise<void> {
    const client = await getClient();
    if (!client) return;
    await this.ensureIndex(client);
  }

  /** HSET each item's derived fields + vector. No-op when disabled. */
  async upsert(account: string | undefined, items: UpsertItem[]): Promise<void> {
    if (items.length === 0) return;
    const client = await getClient();
    if (!client) return;
    if (!(await this.ensureIndex(client))) return;
    const hash = accountHash(account);
    try {
      for (const item of items) {
        const key = `${this.cfg.keyPrefix}${hash}:${item.id}`;
        const args: (string | Buffer | number)[] = [key, 'account', hash];
        for (const [k, v] of Object.entries(item.fields)) args.push(k, String(v));
        args.push('vec', toFloat32Buffer(item.vector));
        await client.hset(...args);
        if (TTL_SEC > 0) await client.expire(key, TTL_SEC);
      }
    } catch (err) {
      // Best-effort write; a failure must not break the request path.
      console.warn('[emailsignal-server] vector upsert failed:', (err as Error).message);
    }
  }

  /**
   * KNN search filtered to `account`. Returns the stored scalar fields of each
   * hit plus a 0..1 `similarity` (1 − COSINE distance), nearest first. `[]` when
   * disabled, empty, or on any error.
   */
  async search(
    account: string | undefined,
    queryVector: number[],
    k: number,
    filter?: { field: string; value: string }
  ): Promise<VectorHit[]> {
    if (k <= 0 || queryVector.length === 0) return [];
    const client = await getClient();
    if (!client) return [];
    if (!(await this.ensureIndex(client))) return [];
    const hash = accountHash(account);
    // Pre-filter by account TAG (and optional extra TAG) before KNN so accounts
    // never mix. `{...}` is RediSearch TAG syntax; escape '-' inside the hash.
    const tag = (v: string) => v.replace(/[-]/g, '\\$&');
    let pre = `@account:{${tag(hash)}}`;
    if (filter) pre += ` @${filter.field}:{${tag(filter.value)}}`;
    const query = `(${pre})=>[KNN ${k} @vec $BLOB AS score]`;
    const returnFields = ['id', 'score', ...this.cfg.fields.map((f) => f.name)];
    try {
      const reply = (await client.call(
        'FT.SEARCH',
        this.cfg.indexName,
        query,
        'PARAMS', '2', 'BLOB', toFloat32Buffer(queryVector),
        'SORTBY', 'score',
        'DIALECT', '2',
        'RETURN', String(returnFields.length), ...returnFields
      )) as unknown[];
      return parseSearchReply(reply, returnFields);
    } catch (err) {
      console.warn('[emailsignal-server] vector search failed:', (err as Error).message);
      return [];
    }
  }
}

/**
 * Parse the flat FT.SEARCH reply: [total, key1, [f1,v1,f2,v2,...], key2, [...]].
 * Converts the COSINE `score` (distance, lower = closer) into a 0..1 similarity.
 */
function parseSearchReply(reply: unknown[], _returnFields: string[]): VectorHit[] {
  const out: VectorHit[] = [];
  if (!Array.isArray(reply) || reply.length < 2) return out;
  for (let i = 1; i < reply.length; i += 2) {
    const fieldArr = reply[i + 1];
    if (!Array.isArray(fieldArr)) continue;
    const rec: Record<string, string> = {};
    for (let j = 0; j < fieldArr.length; j += 2) {
      const name = String(fieldArr[j]);
      const val = fieldArr[j + 1];
      rec[name] = val == null ? '' : String(val);
    }
    const dist = Number(rec['score'] ?? '1');
    const similarity = Number.isFinite(dist) ? Math.max(0, 1 - dist) : 0;
    out.push({ ...rec, id: rec['id'] ?? '', similarity });
  }
  return out;
}

// ── Concrete indexes ────────────────────────────────────────────────────────

const decisionIndex = new VectorIndex({
  indexName: 'es:idx:decision',
  keyPrefix: 'es:vec:decision:',
  fields: [
    { name: 'id', type: 'TEXT' },
    { name: 'title', type: 'TEXT' },
    { name: 'why', type: 'TEXT' },
    { name: 'kind', type: 'TAG' },
    { name: 'urgency', type: 'TAG' },
    { name: 'createdAt', type: 'TEXT' },
    { name: 'emailIds', type: 'TEXT' },
  ],
});

const memoryIndex = new VectorIndex({
  indexName: 'es:idx:mem',
  keyPrefix: 'es:vec:mem:',
  fields: [
    { name: 'id', type: 'TEXT' },
    { name: 'summary', type: 'TEXT' },
    { name: 'kind', type: 'TAG' },
    { name: 'createdAt', type: 'TEXT' },
  ],
});

// ── Decision API (#33/#34) ──────────────────────────────────────────────────

/** Minimal shape the index needs from a decision — only derived fields. */
export interface DecisionLike {
  id: string;
  title: string;
  why: string;
  kind: string;
  urgency: string;
  createdAt: string;
  emailIds: string[];
}

export interface ScoredDecision {
  id: string;
  title: string;
  why: string;
  kind: string;
  urgency: string;
  createdAt: string;
  emailIds: string[];
  similarity: number;
}

/** Warm the connection + create both indexes if missing. Call at boot. */
export function initVectorIndex(): void {
  void decisionIndex.init();
  void memoryIndex.init();
}

/**
 * Upsert decision vectors (1:1 with `decisions`, already L2-normalized). Stores
 * ONLY the derived allowlist below + the vector — never raw bodies. No-op when
 * disabled or when the vector count doesn't match.
 */
export async function upsertDecisionVectors(
  account: string | undefined,
  decisions: DecisionLike[],
  vectors: number[][]
): Promise<void> {
  if (decisions.length !== vectors.length) return;
  await decisionIndex.upsert(
    account,
    decisions.map((d, i) => ({
      id: d.id,
      vector: vectors[i]!,
      fields: {
        id: d.id,
        title: d.title,
        why: d.why,
        kind: d.kind,
        urgency: d.urgency,
        createdAt: d.createdAt,
        emailIds: d.emailIds.join(','),
      },
    }))
  );
}

/** KNN over the account's prior decisions. `[]` when disabled/empty. */
export async function searchDecisions(
  account: string | undefined,
  queryVector: number[],
  k: number
): Promise<ScoredDecision[]> {
  const hits = await decisionIndex.search(account, queryVector, k);
  const str = (h: VectorHit, f: string): string => String(h[f] ?? '');
  return hits.map((h) => ({
    id: str(h, 'id'),
    title: str(h, 'title'),
    why: str(h, 'why'),
    kind: str(h, 'kind'),
    urgency: str(h, 'urgency'),
    createdAt: str(h, 'createdAt'),
    emailIds: str(h, 'emailIds').split(',').filter(Boolean),
    similarity: h.similarity,
  }));
}

// ── Memory API (#35) ────────────────────────────────────────────────────────

export interface MemoryVectorLike {
  id: string;
  summary: string;
  kind: string;
  createdAt: string;
}

export interface ScoredMemory {
  id: string;
  summary: string;
  kind: string;
  createdAt: string;
  similarity: number;
}

/** Upsert one memory-record vector (embedded summary). No-op when disabled. */
export async function upsertMemoryVector(
  account: string | undefined,
  record: MemoryVectorLike,
  vector: number[]
): Promise<void> {
  await memoryIndex.upsert(account, [
    {
      id: record.id,
      vector,
      fields: {
        id: record.id,
        summary: record.summary,
        kind: record.kind,
        createdAt: record.createdAt,
      },
    },
  ]);
}

/** KNN over the account's memory summaries, optionally filtered by `kind`. */
export async function searchMemories(
  account: string | undefined,
  queryVector: number[],
  k: number,
  kind?: string
): Promise<ScoredMemory[]> {
  const hits = await memoryIndex.search(
    account,
    queryVector,
    k,
    kind ? { field: 'kind', value: kind } : undefined
  );
  const str = (h: VectorHit, f: string): string => String(h[f] ?? '');
  return hits.map((h) => ({
    id: str(h, 'id'),
    summary: str(h, 'summary'),
    kind: str(h, 'kind'),
    createdAt: str(h, 'createdAt'),
    similarity: h.similarity,
  }));
}

/** Current status + configured dim, surfaced on /health (mirrors cacheStatus()). */
export function vectorIndexStatus(): { status: Status; dim: number } {
  return { status, dim: DIM };
}

/**
 * Test seam. There is no real Redis in unit tests, so tests inject a fake
 * `RedisLike` (and can force `status`) here, then reset between cases. Not used
 * in production — the lazy `getClient()` owns the real connection.
 */
export const __test = {
  setClient(fake: RedisLike | null, forcedStatus: Status = 'connected'): void {
    clientPromise = Promise.resolve(fake);
    status = fake ? forcedStatus : 'disabled';
    decisionIndex.resetForTests();
    memoryIndex.resetForTests();
  },
  reset(): void {
    clientPromise = null;
    status = 'disabled';
    decisionIndex.resetForTests();
    memoryIndex.resetForTests();
  },
  toFloat32Buffer,
  status: () => status,
};
