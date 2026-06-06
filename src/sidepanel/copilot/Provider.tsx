import React, { useEffect, useState } from 'react';
import { CopilotKit } from '@copilotkit/react-core';
import { STORAGE_KEYS } from '@/common/constants';

interface Props {
  children: React.ReactNode;
}

export const ORCHESTRATOR_INSTRUCTIONS = `You are the EmailSignal Orchestrator answering chat in the side panel.
You NEVER delete, send, forward, or reply to mail. You NEVER act without explicit user approval.
When you have findings to show, prefer rendering them through the available tools rather than plain text:
- show_priority_email, show_clutter_sender_group, show_daily_brief_section
- show_action_ledger, show_agent_trace
When asking the user to act on a proposed change, call request_action_approval (single)
or request_batch_approval (mark_read/archive only) and wait for the user's response.
Be concise. If you don't know, say so.`;

export function CopilotProvider({ children }: Props): JSX.Element {
  const [runtimeUrl, setRuntimeUrl] = useState<string>('http://localhost:3030/copilotkit');

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    void chrome.storage.local.get(STORAGE_KEYS.serverUrl).then((v) => {
      const stored = v[STORAGE_KEYS.serverUrl] as string | undefined;
      if (stored?.trim()) {
        setRuntimeUrl(stored.replace(/\/$/, '') + '/copilotkit');
      }
    });
  }, []);

  return (
    <CopilotKit runtimeUrl={runtimeUrl} showDevConsole={false}>
      {children}
    </CopilotKit>
  );
}
