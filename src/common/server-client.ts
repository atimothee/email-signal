import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { STORAGE_KEYS } from './constants';

/**
 * SSE client used by the extension service worker to talk to the local
 * EmailSignal Node sidecar (default http://localhost:3030).
 *
 * The server endpoints stream events shaped like:
 *   event: trace        data: AgentTraceEvent JSON
 *   event: classification data: { clutter, priorities }
 *   event: chat_reply   data: { text }
 *   event: error        data: { message }
 *   event: done         data: { ok }
 */

export type ServerEvent =
  | { type: 'trace'; data: any }
  | { type: 'classification'; data: { clutter: unknown[] } }
  | { type: 'decisions'; data: { decisions: unknown[]; summary?: string; weaveCallId?: string } }
  | { type: 'chat_reply'; data: { text: string } }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: { ok: boolean } };

const DEFAULT_BASE = 'http://localhost:3030';

export async function getServerBase(): Promise<string> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const v = await chrome.storage.local.get(STORAGE_KEYS.serverUrl);
    const stored = v[STORAGE_KEYS.serverUrl] as string | undefined;
    if (stored?.trim()) return stored.trim();
  }
  return DEFAULT_BASE;
}

export async function isServerHealthy(base?: string): Promise<{ ok: boolean; info?: any; error?: string }> {
  const url = `${base ?? (await getServerBase())}/health`;
  try {
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) return { ok: false, error: `${r.status} ${r.statusText}` };
    const info = await r.json();
    return { ok: true, info };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Send a production-feedback signal to the sidecar (issue #46): a decision the
 * user accepted / snoozed / muted, attached server-side to the Weave call the
 * originating scan produced (`callId` = the scan's `weaveCallId`).
 *
 * Fire-and-forget by contract — feedback must NEVER disrupt the UX, so every
 * failure (sidecar down, Weave off, bad response) is swallowed. The server
 * independently no-ops when it has no Weave key, so the extension can always
 * attempt this without first checking whether tracing is configured.
 */
export async function postFeedback(body: {
  callId: string;
  signal: 'decision' | 'chat';
  value: string;
  decisionId?: string;
}): Promise<void> {
  try {
    const base = await getServerBase();
    await fetch(`${base}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* best-effort: never surface a feedback failure to the user */
  }
}

/**
 * Open an SSE stream against a POST endpoint. Yields parsed events until
 * the server sends `event: done` or the network closes.
 *
 * Note: EventSource (native) doesn't support POST + body, so we use fetch
 * with a streaming body and parse SSE frames ourselves via eventsource-parser.
 */
export async function* sseFetch(
  path: string,
  body: unknown
): AsyncGenerator<ServerEvent, void, void> {
  const base = await getServerBase();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`server returned ${res.status}: ${detail.slice(0, 200)}`);
  }
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  const queue: ServerEvent[] = [];
  let done = false;
  const parser = createParser({
    onEvent(ev: EventSourceMessage) {
      try {
        const data = JSON.parse(ev.data);
        const type = (ev.event ?? 'message') as ServerEvent['type'];
        queue.push({ type, data } as ServerEvent);
        if (type === 'done') done = true;
      } catch {
        /* ignore malformed frames */
      }
    },
  });
  while (true) {
    while (queue.length) yield queue.shift()!;
    if (done) return;
    const { value, done: streamDone } = await reader.read();
    if (streamDone) return;
    parser.feed(decoder.decode(value, { stream: true }));
  }
}
