import type { MemoryStore } from './interface';
import { MemoryRecordSchema, type MemoryRecord, type UserPreference } from '@schemas/index';
import { getServerBase } from '@/common/server-client';

/**
 * Redis-backed memory adapter. Activated when REDIS_URL is set in the
 * agent-server runtime environment.
 *
 * NOTE: we deliberately do not import `ioredis` at module top-level — the
 * Chrome extension service worker cannot load a Node TCP client, so this
 * module must remain tree-shakeable behind a feature check in
 * `createMemoryStore()` (see ./index.ts).
 *
 * Semantic recall: embeddings live server-side (they need the OpenAI key), so
 * recall/index go through the sidecar's `/memory/recall` + `/memory/index`
 * endpoints (Context Retriever, #35). Both are best-effort — when the sidecar or
 * its vector index is unavailable, we fall back to the substring filter below,
 * exactly as before. Semantic recall is an enhancement, never a hard dependency.
 */

/** Best-effort POST to a sidecar memory endpoint. Returns parsed JSON or null. */
async function sidecarPost<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const base = await getServerBase();
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // sidecar down / network error → caller falls back
  }
}

export async function createRedisStore(redisUrl: string, userIdSalt = ''): Promise<MemoryStore> {
  // Dynamic import to keep ioredis out of the extension bundle.
  const { default: Redis } = await import('ioredis');
  const client = new Redis(redisUrl, { lazyConnect: true });
  await client.connect();

  const prefKey = (uid: string) => `es:pref:${userIdSalt}${uid}`;
  const memKey = (uid: string) => `es:mem:${userIdSalt}${uid}`;

  return {
    async listPreferences(userId) {
      const raw = await client.hvals(prefKey(userId));
      return raw.map((s) => JSON.parse(s) as UserPreference);
    },
    async upsertPreference(userId, pref) {
      await client.hset(prefKey(userId), pref.id, JSON.stringify(pref));
    },
    async removePreference(userId, prefId) {
      await client.hdel(prefKey(userId), prefId);
    },
    async recallMemories(userId, query) {
      // Read the user's records from the stream — the authoritative store and the
      // substring fallback's source.
      const range = await client.xrange(memKey(userId), '-', '+', 'COUNT', 500);
      const records = range.map(([, fields]) => {
        const idx = fields.indexOf('json');
        return JSON.parse(fields[idx + 1] ?? '{}') as MemoryRecord;
      });
      const byKind = (list: MemoryRecord[]) =>
        query?.kind ? list.filter((m) => m.kind === query.kind) : list;

      // No query text → recent records (kind-filtered), unchanged behavior.
      if (!query?.q?.trim()) return byKind(records);

      // Semantic recall via the sidecar's Context Retriever. The vector index is
      // namespaced per account; here the account is this store's userId.
      const recalled = await sidecarPost<{ ok: boolean; records?: unknown[] }>(
        '/memory/recall',
        { account: userId, kind: query.kind, q: query.q, k: 10 }
      );
      if (recalled?.ok && Array.isArray(recalled.records)) {
        // Semantic result is authoritative when the index answered. Hydrate each
        // hit to the user's FULL stored record by id (the endpoint returns a
        // best-effort reconstruction); fall back to the reconstruction if a hit
        // isn't in the local stream (e.g. evicted).
        const byId = new Map(records.map((m) => [m.id, m]));
        const hydrated: MemoryRecord[] = [];
        for (const raw of recalled.records) {
          const parsed = MemoryRecordSchema.safeParse(raw);
          if (!parsed.success) continue;
          hydrated.push(byId.get(parsed.data.id) ?? parsed.data);
        }
        return hydrated;
      }

      // Sidecar/index unavailable → substring filter, exactly as before.
      const q = query.q.toLowerCase();
      return byKind(records).filter((m) => m.summary.toLowerCase().includes(q));
    },
    async appendMemory(userId, rec) {
      await client.xadd(memKey(userId), '*', 'json', JSON.stringify(rec));
      // Best-effort: embed + index the summary so it's semantically recallable
      // immediately. A sidecar/index failure is a silent no-op (the record is
      // already durable in the stream above and still substring-recallable).
      void sidecarPost('/memory/index', { account: userId, record: rec });
    },
  };
}
