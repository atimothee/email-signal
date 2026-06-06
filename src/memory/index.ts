import type { MemoryStore } from './interface';
import { JsonMemoryStore } from './json-store';

let cached: MemoryStore | null = null;

/**
 * Resolve the active memory store. Order of preference:
 *  1. REDIS_URL is set AND we're running in Node (eval script / sidepanel-web). Use Redis.
 *  2. Otherwise use the JSON fallback (chrome.storage.local in-extension,
 *     in-memory map in tests).
 */
export async function getMemoryStore(): Promise<MemoryStore> {
  if (cached) return cached;
  const isNode =
    typeof process !== 'undefined' &&
    !!process.versions?.node &&
    typeof chrome === 'undefined';
  const url = isNode ? process.env['REDIS_URL'] : undefined;
  if (url) {
    const { createRedisStore } = await import('./redis-store');
    cached = await createRedisStore(url);
    return cached;
  }
  cached = JsonMemoryStore;
  return cached;
}

export type { MemoryStore } from './interface';
