import { useEffect } from 'react';
import { parseExtMessage } from '@schemas/index';
import type { MailProvider } from '@schemas/index';
import { usePanelStore } from './store';
import { STORAGE_KEYS } from '@/common/constants';
import { providerNewTabUrl } from '@/providers/url-patterns';

export function useExtensionBridge(): void {
  const ingest = usePanelStore((s) => s.ingest);
  const setDryRun = usePanelStore((s) => s.setDryRun);
  const setKillSwitch = usePanelStore((s) => s.setKillSwitch);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const handler = (raw: unknown) => {
      const msg = parseExtMessage(raw);
      if (msg) ingest(msg);
    };
    chrome.runtime.onMessage.addListener(handler);
    // hydrate persisted settings
    chrome.storage.local
      .get([STORAGE_KEYS.dryRun, STORAGE_KEYS.killSwitch])
      .then((v) => {
        setDryRun(v[STORAGE_KEYS.dryRun] !== false);
        setKillSwitch(!!v[STORAGE_KEYS.killSwitch]);
      });
    // wave hello so background can backfill recent ledger
    chrome.runtime.sendMessage({ kind: 'panel/hello' });
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [ingest, setDryRun, setKillSwitch]);
}

export async function send(msg: import('@schemas/index').ExtMessage): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    await chrome.runtime.sendMessage(msg);
  } catch (err) {
    console.debug('[EmailSignal] panel send failed', err);
  }
}

/**
 * Open the user's mail provider in a new tab. "Connecting" an inbox here just
 * means having a signed-in mail tab for the content script to read — so this
 * is the one-click way to get there when no account has been detected yet.
 *
 * When the side panel already knows which provider the user is on (because a
 * previous scan reported an account), we honor that. Otherwise we default to
 * Gmail — historically the first-supported provider — and the user can switch
 * tabs to Outlook themselves if that's their account.
 */
export function openMailTab(provider?: MailProvider): void {
  if (typeof chrome === 'undefined' || !chrome.tabs?.create) return;
  const known = provider ?? usePanelStore.getState().account?.provider;
  void chrome.tabs.create({ url: providerNewTabUrl(known ?? 'gmail') });
}

/**
 * Back-compat alias retained for components that imported the old name. The
 * implementation is provider-aware now — it opens whichever provider the user
 * is signed into when known.
 */
export const openGmailTab = openMailTab;
