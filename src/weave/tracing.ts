import { nanoid } from 'nanoid';
import { AgentTraceEvent, AgentTraceEventSchema } from '@schemas/index';
import { STORAGE_KEYS } from '@/common/constants';
import { broadcastTrace } from './bridge';

/**
 * In-extension trace cockpit.
 *
 * This module records `AgentTraceEvent`s in the extension (service worker /
 * side panel), persists them to `chrome.storage` so the cockpit can re-hydrate
 * on reload, broadcasts them to the side panel live, and fans them out to
 * in-process subscribers (used by evals/tests).
 *
 * It does NOT talk to W&B. The extension build stubs out `weave` (no Node APIs
 * in the browser), so real Weave traces are produced ONLY in the Node sidecar
 * (`server/agents.ts`), which routes the OpenAI Agents SDK through a
 * Weave-wrapped client. See the README's Observability section.
 */

let sessionId = nanoid();

type TraceSubscriber = (event: AgentTraceEvent) => void;
const subscribers = new Set<TraceSubscriber>();

/**
 * Subscribe to every recorded trace event. Returns an unsubscribe function.
 * Used by evals to assert on the agent timeline without needing
 * chrome.storage. Also useful for tests that pin the exact handoff order.
 */
export function subscribeTrace(cb: TraceSubscriber): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function startSession(): string {
  sessionId = nanoid();
  void recordTrace({ kind: 'session_start', message: 'session started' });
  return sessionId;
}

export function endSession(): void {
  void recordTrace({ kind: 'session_end', message: 'session ended' });
}

export async function recordTrace(
  partial: Partial<AgentTraceEvent> & Pick<AgentTraceEvent, 'kind'>
): Promise<AgentTraceEvent> {
  const event = AgentTraceEventSchema.parse({
    id: nanoid(),
    sessionId: partial.sessionId ?? sessionId,
    turnId: partial.turnId,
    kind: partial.kind,
    agent: partial.agent,
    tool: partial.tool,
    message: partial.message,
    data: partial.data ?? {},
    at: new Date().toISOString(),
    elapsedMs: partial.elapsedMs,
  });

  // 1. Persist locally so the cockpit panel can re-hydrate on reload.
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const cur = (await chrome.storage.local.get(STORAGE_KEYS.traceEvents))[
      STORAGE_KEYS.traceEvents
    ] as AgentTraceEvent[] | undefined;
    const next = [...(cur ?? []), event].slice(-500);
    await chrome.storage.local.set({ [STORAGE_KEYS.traceEvents]: next });
  }
  // 2. Broadcast to the side panel.
  await broadcastTrace(event);
  // 3. Fan out to in-process subscribers (used in evals/tests).
  for (const cb of subscribers) {
    try {
      cb(event);
    } catch (err) {
      console.debug('[EmailSignal] trace subscriber failed', err);
    }
  }
  return event;
}

export function getSessionId(): string {
  return sessionId;
}
