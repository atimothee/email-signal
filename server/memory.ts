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
  hvals(key: string): Promise<string[]>;
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
 * Persist the client's preferences to Redis and return the union of those plus
 * anything already stored for the account. The client copy wins on conflicts
 * (it's the freshest), but Redis fills in preferences set on another device.
 *
 * On a miss / disabled Redis, returns the client list unchanged.
 */
export async function recallAndMergePreferences(
  account: string | undefined,
  clientPrefs: UserPreference[]
): Promise<UserPreference[]> {
  const client = await getClient();
  if (!client) return clientPrefs;

  const key = prefKey(account);
  const byIdentity = new Map<string, UserPreference>();

  // Start from what Redis already knows.
  try {
    const stored = await client.hvals(key);
    for (const raw of stored) {
      try {
        const p = JSON.parse(raw) as UserPreference;
        byIdentity.set(prefIdentity(p), p);
      } catch {
        /* skip a corrupt record */
      }
    }
  } catch {
    // Redis unreadable mid-flight — fall back to the client list.
    return clientPrefs;
  }

  // Client copy wins; mirror any new/updated client prefs back into Redis.
  for (const p of clientPrefs) {
    const id = prefIdentity(p);
    byIdentity.set(id, p);
    try {
      await client.hset(key, id, JSON.stringify(p));
    } catch {
      /* best-effort write */
    }
  }

  return Array.from(byIdentity.values());
}
