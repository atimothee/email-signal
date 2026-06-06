import { nanoid } from 'nanoid';
import type { AgentTraceEvent, AgentTraceEventKind } from '../src/schemas/index.js';

export interface SseWriter {
  send: (event: string, data: unknown) => Promise<void>;
}

/**
 * Emits a normalized AgentTraceEvent to the SSE stream the extension is
 * listening on. The extension's bridge feeds these back into recordTrace()
 * so the cockpit fills in real-time.
 */
export async function emit(
  writer: SseWriter,
  sessionId: string,
  turnId: string,
  partial: Omit<AgentTraceEvent, 'id' | 'sessionId' | 'turnId' | 'at' | 'data'> &
    Partial<Pick<AgentTraceEvent, 'data'>>
): Promise<void> {
  const event: AgentTraceEvent = {
    id: nanoid(),
    sessionId,
    turnId,
    at: new Date().toISOString(),
    kind: partial.kind,
    agent: partial.agent,
    tool: partial.tool,
    message: partial.message,
    data: partial.data ?? {},
  };
  await writer.send('trace', event);
}

export function traceKind(k: AgentTraceEventKind): AgentTraceEventKind {
  return k;
}
