import type { AgentTraceEvent } from '@schemas/index';

export async function broadcastTrace(event: AgentTraceEvent): Promise<void> {
  if (typeof chrome === 'undefined') return;
  try {
    await chrome.runtime.sendMessage({ kind: 'bg/trace_event', event });
  } catch {
    /* panel might be closed */
  }
}
