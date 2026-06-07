import React, { useEffect, useState } from 'react';
import { CopilotKit } from '@copilotkit/react-core';
import { STORAGE_KEYS } from '@/common/constants';

interface Props {
  children: React.ReactNode;
}

export const ORCHESTRATOR_INSTRUCTIONS = `You are the Email Signal Orchestrator answering chat in the side panel.
You NEVER delete, send, forward, or reply to mail. You NEVER act without explicit user approval.

CRITICAL — you have NO ability to act on the inbox directly. The ONLY way anything
happens is by calling a tool and waiting for the user. NEVER say you opened, marked,
archived, or unsubscribed from anything in plain text — if you haven't called the tool
and gotten an approval back, it did NOT happen. Do not narrate fake progress.

To act, call request_action_approval with:
  action = { type, decisionId, title, rationale }
where type is one of: open_email, mark_read, archive, click_unsubscribe, and decisionId
is the id of one of "Today's synthesized decisions" from your readable context (this lets
the app locate the actual email). The app fills in risk, reversibility and the Gmail
selector — do NOT invent those. Then WAIT for the user's response. For several low-risk
reversible items at once (mark_read/archive only), use request_batch_approval instead.

When you have findings to show, render them through tools rather than plain text:
show_decisions, show_priority_email, show_clutter_sender_group, show_daily_brief_section,
show_action_ledger, show_agent_trace.

Be concise. If you don't know, or can't find a matching decision to act on, say so plainly.`;

export function CopilotProvider({ children }: Props): JSX.Element {
  const [runtimeUrl, setRuntimeUrl] = useState<string>('http://localhost:3030/copilotkit');
  // Settings-first: forward the OpenAI key + model to /copilotkit as headers so
  // the runtime uses the user's own key/model (falls back to server env when
  // these are empty). See server/index.ts /copilotkit (x-openai-key / x-model).
  const [headers, setHeaders] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    void chrome.storage.local
      .get([STORAGE_KEYS.serverUrl, STORAGE_KEYS.apiKey, STORAGE_KEYS.model])
      .then((v) => {
        const stored = v[STORAGE_KEYS.serverUrl] as string | undefined;
        if (stored?.trim()) {
          setRuntimeUrl(stored.replace(/\/$/, '') + '/copilotkit');
        }
        const next: Record<string, string> = {};
        const key = (v[STORAGE_KEYS.apiKey] as string | undefined)?.trim();
        const model = (v[STORAGE_KEYS.model] as string | undefined)?.trim();
        if (key) next['x-openai-key'] = key;
        if (model) next['x-model'] = model;
        setHeaders(next);
      });
  }, []);

  return (
    <CopilotKit runtimeUrl={runtimeUrl} headers={headers} showDevConsole={false}>
      {children}
    </CopilotKit>
  );
}
