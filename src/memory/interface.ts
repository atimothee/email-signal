import type { MemoryRecord, UserPreference } from '@schemas/index';

/**
 * RedisMemoryStore — the contract the agents use. Implementations:
 *  - RedisStore (server-side, requires REDIS_URL)
 *  - JsonStore (filesystem fallback for local dev / browser-side via chrome.storage)
 *
 * Schema sketch (Redis):
 *   es:pref:<userId>              hash    { id -> JSON(UserPreference) }
 *   es:mem:<userId>               stream  XADD MemoryRecord JSON  (source of truth)
 *   es:vec:mem:<accountHash>:<id> hash    { summary, kind, createdAt, vec }  — RediSearch
 *                                         vector index for semantic recall (Context
 *                                         Retriever, server/vector-index.ts). Written on
 *                                         appendMemory + queried by recallMemories via the
 *                                         sidecar /memory/index + /memory/recall endpoints.
 */
export interface MemoryStore {
  listPreferences(userId: string): Promise<UserPreference[]>;
  upsertPreference(userId: string, pref: UserPreference): Promise<void>;
  removePreference(userId: string, prefId: string): Promise<void>;

  recallMemories(userId: string, query?: { kind?: MemoryRecord['kind']; q?: string }): Promise<MemoryRecord[]>;
  appendMemory(userId: string, rec: MemoryRecord): Promise<void>;
}
