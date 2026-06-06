import type { MemoryStore } from './interface';
import type { MemoryRecord, UserPreference } from '@schemas/index';

/**
 * Redis-backed memory adapter. Activated when REDIS_URL is set in the
 * agent-server runtime environment.
 *
 * NOTE: we deliberately do not import `ioredis` at module top-level — the
 * Chrome extension service worker cannot load a Node TCP client, so this
 * module must remain tree-shakeable behind a feature check in
 * `createMemoryStore()` (see ./index.ts).
 */
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
      // MVP: read entire list back from the stream and filter in app space.
      // Replace with vector search / Redis Iris Context Retriever when wired.
      const range = await client.xrange(memKey(userId), '-', '+', 'COUNT', 500);
      const records = range.map(([, fields]) => {
        const idx = fields.indexOf('json');
        return JSON.parse(fields[idx + 1] ?? '{}') as MemoryRecord;
      });
      return records.filter((m) => {
        if (query?.kind && m.kind !== query.kind) return false;
        if (query?.q && !m.summary.toLowerCase().includes(query.q.toLowerCase())) return false;
        return true;
      });
    },
    async appendMemory(userId, rec) {
      await client.xadd(memKey(userId), '*', 'json', JSON.stringify(rec));
    },
  };
}
