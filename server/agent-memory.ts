/// <reference types="node" />
import { createHash } from 'node:crypto';
import { MemoryRecordSchema, type MemoryRecord } from '../src/schemas/index.js';

/**
 * Best-effort REST client for the Redis Agent Memory Server.
 * (https://github.com/redis/agent-memory-server)
 *
 * The sidecar talks to the agent-memory-server over plain `fetch`. That server
 * owns the durable, semantic long-term memory (vector search over derived
 * summaries) plus per-session working memory. This wrapper is intentionally
 * thin: it maps our `MemoryRecord` shape to/from the server's memory object and
 * keeps every call best-effort.
 *
 * Best-effort posture (mirrors server/cache.ts + server/memory.ts):
 *   - The base URL is read lazily from `AGENT_MEMORY_URL` at call time. If it's
 *     unset, status is 'disabled' and every operation is a silent no-op:
 *     `searchLongTerm` returns [], the writers resolve void, `fetch` is never
 *     called. The memory feature simply doesn't exist for that deployment.
 *   - Each request has a short (~2s) AbortController timeout so a dead service
 *     never stalls the request path. On timeout / network error / non-2xx we log
 *     a single console.warn, flip status to 'error', and degrade (return [] /
 *     resolve). We NEVER throw on the request path.
 *
 * Privacy: only derived text ever leaves this process. A `MemoryRecord.summary`
 * is already-derived text (a learned pattern, a sender domain, a topic the user
 * chose) — never a raw email body. We pass through summary/kind/details/topics
 * and nothing else; this module deliberately has no field that could carry a
 * body/raw payload. Accounts are isolated by hashing the account into `user_id`
 * (sha256(account.toLowerCase()).slice(0,16), 'anon' when absent) — account A's
 * user_id can never collide with account B's.
 *
 * Swapping the OSS agent-memory-server for managed Redis Iris later is a base-URL
 * change only (`AGENT_MEMORY_URL`); the REST contract is the same.
 */

/** REST contract: namespace all of email-signal's memories under this prefix. */
const NAMESPACE = 'email-signal';
/** Fail fast — a misconfigured/unreachable service must not stall a scan. */
const FETCH_TIMEOUT_MS = 2000;

/** Our kinds, used to validate a server `memory_type` back into our enum. */
const KINDS = ['preference', 'interaction_pattern', 'fact', 'topic_interest'] as const;
type Kind = (typeof KINDS)[number];

export type AgentMemoryStatus = { status: 'disabled' | 'connecting' | 'connected' | 'error' };

let status: AgentMemoryStatus['status'] = 'disabled';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Hashed account → `user_id` namespace. Matches server/memory.ts prefKey logic. */
function userId(account: string | undefined): string {
  return account?.trim() ? sha256(account.trim().toLowerCase()).slice(0, 16) : 'anon';
}

/**
 * Resolve the base URL lazily (read at call time, not module load, so tests and
 * env changes take effect). Empty/unset → null and status 'disabled'.
 */
function getBase(): string | null {
  const url = process.env['AGENT_MEMORY_URL']?.trim();
  if (!url) {
    status = 'disabled';
    return null;
  }
  // Don't downgrade a sticky 'error' to 'connecting' on every call; only move to
  // 'connecting' from the initial disabled state. A successful request sets
  // 'connected'; a failed one sets 'error'.
  if (status === 'disabled') status = 'connecting';
  return url.replace(/\/$/, '');
}

/**
 * Single best-effort POST/PUT. Resolves the parsed JSON on a 2xx, or null on
 * timeout / network error / non-2xx (logging one warning and flipping to
 * 'error'). Never throws.
 */
async function request(
  method: 'POST' | 'PUT',
  url: string,
  body: unknown
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      degrade(`agent-memory ${method} ${res.status}`);
      return null;
    }
    status = 'connected';
    // Some endpoints return empty/ack bodies; tolerate non-JSON.
    try {
      return await res.json();
    } catch {
      return {};
    }
  } catch (err) {
    degrade(`agent-memory ${method} failed: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function degrade(msg: string): void {
  if (status !== 'error') {
    status = 'error';
    console.warn(`[emailsignal-server] ${msg}; agent memory degraded`);
  }
}

/**
 * Mirror a chat/scan turn into the session's working memory. Best-effort: the
 * server uses this to summarize a session into long-term memory over time.
 * Only role/content text is sent — the caller already derives these messages.
 */
export async function putWorkingMemory(
  account: string | undefined,
  sessionId: string,
  messages: { role: string; content: string }[]
): Promise<void> {
  const base = getBase();
  if (!base) return;
  const uid = userId(account);
  await request(
    'PUT',
    `${base}/v1/working-memory/${encodeURIComponent(sessionId)}`,
    {
      session_id: sessionId,
      user_id: uid,
      namespace: NAMESPACE,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }
  );
}

/**
 * Semantic search over long-term memory for this account. Returns best-effort
 * `MemoryRecord`s reconstructed from the server's memory objects; entries that
 * fail schema validation are dropped. Returns [] when disabled or on any error.
 */
export async function searchLongTerm(
  account: string | undefined,
  query: string,
  opts?: { limit?: number; kind?: string }
): Promise<MemoryRecord[]> {
  const base = getBase();
  if (!base) return [];
  const uid = userId(account);
  const body: Record<string, unknown> = {
    text: query,
    user_id: { eq: uid },
    namespace: { eq: NAMESPACE },
    limit: opts?.limit ?? 10,
  };
  if (opts?.kind) body['memory_type'] = { eq: opts.kind };

  const json = await request('POST', `${base}/v1/long-term-memory/search`, body);
  if (!json || typeof json !== 'object') return [];
  const memories = (json as { memories?: unknown }).memories;
  if (!Array.isArray(memories)) return [];

  const out: MemoryRecord[] = [];
  for (const m of memories) {
    const rec = fromServerMemory(m);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * Persist one `MemoryRecord` to long-term memory. Best-effort no-op when
 * disabled / on error. Only the derived summary/kind/topics/id leave the process.
 */
export async function createLongTerm(
  account: string | undefined,
  record: MemoryRecord
): Promise<void> {
  const base = getBase();
  if (!base) return;
  const uid = userId(account);
  await request('POST', `${base}/v1/long-term-memory/`, {
    memories: [toServerMemory(uid, record)],
  });
}

/** Current status, surfaced on /health for verification. */
export function agentMemoryStatus(): AgentMemoryStatus {
  return { status };
}

/**
 * Test-only: reset cached module state (status) and let `getBase` re-read the
 * env. The base URL is already read lazily, so this only resets `status`.
 * Guarded by name; not part of the public contract.
 */
export function __resetForTests(): void {
  status = 'disabled';
}

/* ----------------------------- mapping helpers ---------------------------- */

/**
 * Our `MemoryRecord` → the server's long-term memory object. Only derived text
 * fields are included — no body/raw payload exists in the source record, so none
 * can leak. `kind` is carried both as `memory_type` and as a topic.
 */
function toServerMemory(uid: string, record: MemoryRecord): Record<string, unknown> {
  return {
    id: record.id,
    text: record.summary,
    memory_type: record.kind,
    topics: [record.kind],
    user_id: uid,
    namespace: NAMESPACE,
  };
}

/**
 * The server's memory object → a best-effort `MemoryRecord`, validated against
 * `MemoryRecordSchema`. Returns null if the reconstruction can't be validated.
 */
function fromServerMemory(raw: unknown): MemoryRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;

  const text = typeof m['text'] === 'string' ? (m['text'] as string) : '';
  if (!text) return null;

  const serverType = typeof m['memory_type'] === 'string' ? (m['memory_type'] as string) : '';
  const kind: Kind = (KINDS as readonly string[]).includes(serverType)
    ? (serverType as Kind)
    : 'fact';

  const id = typeof m['id'] === 'string' && m['id'] ? (m['id'] as string) : crypto.randomUUID();

  const createdAt =
    typeof m['created_at'] === 'string' && isIsoDate(m['created_at'] as string)
      ? (m['created_at'] as string)
      : new Date().toISOString();

  const candidate = {
    id,
    kind,
    summary: text.slice(0, 400),
    details: {},
    confidence: 1,
    createdAt,
    source: 'system' as const,
    approvedByUser: true,
  };

  const parsed = MemoryRecordSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function isIsoDate(s: string): boolean {
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}
