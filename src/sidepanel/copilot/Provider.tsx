import React, { useEffect, useState } from 'react';
import { CopilotKit } from '@copilotkit/react-core';
import { STORAGE_KEYS } from '@/common/constants';

interface Props {
  children: React.ReactNode;
}

/**
 * Wraps the app in CopilotKit. We point `runtimeUrl` at the local Hono sidecar
 * (path: /copilotkit). When the sidecar isn't running CopilotKit gracefully
 * no-ops; our custom chat path (panel/chat_message via the service worker)
 * continues to work — generative-UI rendering of cards is purely client-side.
 */
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
    <CopilotKit runtimeUrl={runtimeUrl} agent="emailsignal_orchestrator">
      {children}
    </CopilotKit>
  );
}
