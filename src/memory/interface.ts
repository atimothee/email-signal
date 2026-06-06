import type { MemoryRecord, UserPreference } from '@schemas/index';

/**
 * RedisMemoryStore — the contract the agents use. Implementations:
 *  - RedisStore (server-side, requires REDIS_URL)
 *  - JsonStore (filesystem fallback for local dev / browser-side via chrome.storage)
 *
 * Schema sketch (Redis):
 *   es:pref:<userId>              hash    { id -> JSON(UserPreference) }
 *   es:mem:<userId>               stream  XADD MemoryRecord JSON
 *   es:mem:index:<userId>:<kind>  set     memory ids
 *   es:mem:embed:<userId>         hash    { id -> base64 float32 }  (placeholder for vector search)
 */
export interface MemoryStore {
  listPreferences(userId: string): Promise<UserPreference[]>;
  upsertPreference(userId: string, pref: UserPreference): Promise<void>;
  removePreference(userId: string, prefId: string): Promise<void>;

  recallMemories(userId: string, query?: { kind?: MemoryRecord['kind']; q?: string }): Promise<MemoryRecord[]>;
  appendMemory(userId: string, rec: MemoryRecord): Promise<void>;
}
