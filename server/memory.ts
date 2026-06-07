/// <reference types="node" />
import { createHash } from 'node:crypto';
import type { UserPreference } from '../src/schemas/index.js';

/**
 * Server-side Agent Memory (Redis-backed).
 *
 * The extension recalls the user's preferences from chrome.storage and forwards
 * them with each classify request. This module mirrors those preferences into
 * Redis (keyed per account) so memory is durable and shared across devices, and
 * recalls anything Redis already knows that the client didn't send — so the
 * synthesizer always sees the union.
 *
 * Like the classify cache, this is best-effort: with no REDIS_URL or an
 * unreachable server, every call is a silent no-op and the pipeline falls back
 * to whatever the client passed.
 *
 * Privacy: the account address is hashed into the key namespace; only the
 * preference records (sender domains, topic strings the user themselves chose)
 * are stored — never raw email content.
 */

type RedisLike = {
  hkeys(key: string): Promise<string[]>;
  hdel(key: string, ...fields: string[]): Promise<unknown>;
  hset(key: string, field: string, value: string): Promise<unknown>;
};

let clientPromise: Promise<RedisLike | null> | null = null;

function getClient(): Promise<RedisLike | null> {
  if (clientPromise) return clientPromise;
  const url = process.env['REDIS_URL']?.trim();
  if (!url) {
    clientPromise = Promise.resolve(null);
    return clientPromise;
  }
  clientPromise = (async () => {
    try {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
      });
      client.on('error', () => {
        /* surfaced by the classify cache; stay quiet here to avoid double logs */
      });
      await client.connect();
      return client as unknown as RedisLike;
    } catch {
      return null;
    }
  })();
  return clientPromise;
}

function prefKey(account: string | undefined): string {
  const accountHash = account?.trim()
    ? sha256(account.trim().toLowerCase()).slice(0, 16)
    : 'anon';
  return `es:pref:${accountHash}`;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Identity for de-duping a preference regardless of its (client-assigned) id. */
function prefIdentity(p: UserPreference): string {
  return `${p.kind}:${p.key.toLowerCase()}`;
}

/**
 * Mirror the client's preferences into Redis and return the authoritative set.
 *
 * The extension's chrome.storage is the source of truth and forwards its FULL
 * preference set on every scan, so a removal shows up as ABSENCE from the list.
 * We therefore RECONCILE Redis to that snapshot — deleting fields the client no
 * longer has — rather than unioning (a union would resurrect deleted prefs
 * forever, and they'd keep shaping synthesis and the cache key).
 *
 * The return value is exactly the client snapshot: it's the freshest truth, and
 * the cache key / synthesis must reflect what the user currently wants.
 *
 * NOTE: true additive cross-device merge (pick up a pref set on another device
 * without resurrecting one deleted here) needs per-pref tombstones/timestamps —
 * deferred deliberately. Today Redis is a durable mirror of one client's state.
 *
 * Best-effort: a missing/unreachable Redis is a no-op and returns clientPrefs.
 */
export async function reconcilePreferences(
  account: string | undefined,
  clientPrefs: UserPreference[]
): Promise<UserPreference[]> {
  const client = await getClient();
  if (!client) return clientPrefs;

  const key = prefKey(account);
  const wanted = new Set(clientPrefs.map(prefIdentity));
  try {
    // Drop anything Redis still holds that the client has since removed.
    const existing = await client.hkeys(key);
    const stale = existing.filter((f) => !wanted.has(f));
    if (stale.length) await client.hdel(key, ...stale);
    // Upsert the current set.
    for (const p of clientPrefs) {
      await client.hset(key, prefIdentity(p), JSON.stringify(p));
    }
  } catch {
    /* best-effort mirror; client snapshot is still authoritative */
  }

  return clientPrefs;
}
