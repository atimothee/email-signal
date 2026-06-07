/// <reference types="node" />
import { createHash } from 'node:crypto';
import type {
  EmailCandidate,
  ClutterFinding,
  Decision,
  UserPreference,
} from '../src/schemas/index.js';

/**
 * Exact-match classification cache (server-side, Redis-backed).
 *
 * The sidecar re-runs the full clutter + synthesis pipeline on every scan, which
 * means a rescan of an unchanged inbox pays for ~20+ OpenAI calls it has already
 * made. This module short-circuits that: the derived `{clutter, decisions}` for a
 * given (account, exact set of email ids) is cached and replayed.
 *
 * Privacy: keys are SHA-256 hashes; the stored VALUE is the derived result
 * (decision titles, sender display names, clutter labels) — never raw bodies.
 * The cache is keyed per account so two Gmail accounts on one Redis never mix.
 *
 * Degradation: if REDIS_URL is unset or Redis is unreachable, every call here is
 * a silent no-op and the pipeline runs exactly as before. The cache is a pure
 * optimization — never a dependency.
 */

type ClassifyResult = { clutter: ClutterFinding[]; decisions: Decision[] };

/** Bump when the prompt/output contract changes so stale results aren't served. */
const CACHE_VERSION = 'v1';
const MODEL = process.env['EMAIL_SIGNAL_MODEL'] ?? 'gpt-4.1-mini';
/** Default 7 days. Emails are immutable, but bound memory + let synthesis evolve. */
const TTL_SEC = Number(process.env['EMAIL_SIGNAL_CACHE_TTL_SEC'] ?? 7 * 24 * 60 * 60);

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  quit(): Promise<unknown>;
};

let clientPromise: Promise<RedisLike | null> | null = null;
let status: 'disabled' | 'connecting' | 'connected' | 'error' = 'disabled';

/**
 * Lazily connect to Redis. Returns null (and flips status to disabled/error) when
 * REDIS_URL is missing or the server can't be reached — callers then no-op.
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
      // maxRetriesPerRequest: don't let a dead Redis hang the request path; fail
      // fast and fall through to the live pipeline.
      const client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      client.on('error', (err: Error) => {
        if (status !== 'error') {
          status = 'error';
          console.warn('[emailsignal-server] redis error; cache disabled:', err.message);
        }
      });
      await client.connect();
      status = 'connected';
      console.log('[emailsignal-server] classify cache connected to Redis');
      return client as unknown as RedisLike;
    } catch (err) {
      status = 'error';
      console.warn(
        '[emailsignal-server] redis connect failed; cache disabled:',
        (err as Error).message
      );
      return null;
    }
  })();
  return clientPromise;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Stable fingerprint of the preferences that feed synthesis. Folded into the
 * cache key so that changing a preference (e.g. ignoring a sender) busts the
 * cache instead of replaying decisions made under the old preferences.
 */
export function fingerprintPreferences(prefs: UserPreference[] | undefined): string {
  if (!prefs || prefs.length === 0) return 'none';
  const norm = prefs
    .map((p) => `${p.kind}:${p.key}:${String(p.value)}`)
    .sort()
    .join('|');
  return sha256(norm).slice(0, 16);
}

/**
 * Deterministic key for an (account, email-set, preferences) triple. Decisions
 * are synthesized over the WHOLE set under the user's preferences, so all three
 * form the cache identity — ids sorted so order never matters. Account is hashed
 * into a namespace so accounts never collide.
 */
export function classifyCacheKey(
  account: string | undefined,
  candidates: EmailCandidate[],
  prefs?: UserPreference[]
): string {
  const accountHash = account?.trim()
    ? sha256(account.trim().toLowerCase()).slice(0, 16)
    : 'anon';
  const ids = candidates.map((c) => c.id).sort();
  const idsHash = sha256(ids.join('\n')).slice(0, 40);
  const prefHash = fingerprintPreferences(prefs);
  return `es:classify:${CACHE_VERSION}:${MODEL}:${accountHash}:${idsHash}:${prefHash}`;
}

/** Returns the cached result for `key`, or null on miss / disabled / error. */
export async function getCachedClassification(key: string): Promise<ClassifyResult | null> {
  const client = await getClient();
  if (!client) return null;
  try {
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as ClassifyResult;
  } catch (err) {
    console.warn('[emailsignal-server] cache read failed:', (err as Error).message);
    return null;
  }
}

/** Stores `value` under `key` with the configured TTL. No-op when disabled. */
export async function setCachedClassification(key: string, value: ClassifyResult): Promise<void> {
  const client = await getClient();
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), 'EX', TTL_SEC);
  } catch (err) {
    console.warn('[emailsignal-server] cache write failed:', (err as Error).message);
  }
}

/** Current cache status, surfaced on /health for verification. */
export function cacheStatus(): { status: typeof status; ttlSec: number } {
  return { status, ttlSec: TTL_SEC };
}

/** Warm the connection at boot so the first scan doesn't pay connect latency. */
export function initCache(): void {
  void getClient();
}
