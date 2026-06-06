import { useEffect } from 'react';
import { parseExtMessage } from '@schemas/index';
import { usePanelStore } from './store';
import { STORAGE_KEYS } from '@/common/constants';

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
      .get([
        STORAGE_KEYS.dryRun,
        STORAGE_KEYS.killSwitch,
        'emailsignal.actionItems.snoozed',
        'emailsignal.actionItems.done',
      ])
      .then((v) => {
        setDryRun(v[STORAGE_KEYS.dryRun] !== false);
        setKillSwitch(!!v[STORAGE_KEYS.killSwitch]);
        const snoozed = (v['emailsignal.actionItems.snoozed'] as string[] | undefined) ?? [];
        const done = (v['emailsignal.actionItems.done'] as string[] | undefined) ?? [];
        if (snoozed.length || done.length) {
          usePanelStore.setState({
            snoozedActionItemIds: snoozed,
            doneActionItemIds: done,
          });
        }
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
