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
  | { type: 'classification'; data: { clutter: unknown[]; priorities: unknown[] } }
  | { type: 'action_items'; data: { items: unknown[] } }
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
