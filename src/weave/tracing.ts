import { nanoid } from 'nanoid';
import { AgentTraceEvent, AgentTraceEventSchema } from '@schemas/index';
import { STORAGE_KEYS } from '@/common/constants';
import { broadcastTrace } from './bridge';

/**
 * W&B Weave integration.
 *
 * Strategy:
 *  - In Node contexts (eval scripts, optional local server), we lazily load
 *    `weave` and call `weave.init({ project })`. The OpenAI Agents SDK has
 *    its own tracing processor we can attach (WeaveTracingProcessor).
 *  - In the extension service worker we CANNOT load the full Weave SDK
 *    (no Node APIs), so we record AgentTraceEvent records locally and
 *    stream them to the side panel. Anything labeled with the same
 *    sessionId is then re-uploaded server-side when a Node companion
 *    process runs (out of V1 scope, see roadmap).
 *
 * Either way every `recordTrace` call also pushes the event to the side
 * panel cockpit immediately.
 */

let sessionId = nanoid();
let weaveReady = false;
let weaveModule: typeof import('weave') | null = null;

export async function initWeave(opts: { project?: string; apiKey?: string } = {}): Promise<void> {
  if (typeof chrome !== 'undefined') return; // skip in extension
  if (weaveReady) return;
  try {
    weaveModule = await import('weave');
    const project = opts.project ?? process.env['WANDB_PROJECT'] ?? 'email-signal';
    // The `weave` TS SDK exposes `init(projectName)` in current releases.
    // We guard with `as any` to stay forward-compatible.
    await (weaveModule as any).init(project);
    weaveReady = true;
  } catch (err) {
    // Weave is optional; tracing falls back to local-only.
    console.warn('[EmailSignal] weave init failed, falling back to local trace', err);
  }
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
  // 2. Push to Weave when available.
  if (weaveReady && weaveModule) {
    try {
      // Minimal manual span — agents SDK integration handles richer traces.
      await (weaveModule as any).log?.({
        name: event.kind,
        attributes: {
          agent: event.agent,
          tool: event.tool,
          sessionId: event.sessionId,
          turnId: event.turnId,
          ...event.data,
        },
      });
    } catch (err) {
      console.debug('[EmailSignal] weave.log failed', err);
    }
  }
  // 3. Broadcast to the side panel.
  await broadcastTrace(event);
  return event;
}

export function getSessionId(): string {
  return sessionId;
}
