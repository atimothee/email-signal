import { ExtMessage, parseExtMessage } from '@schemas/index';

type Listener = (msg: ExtMessage, sender: chrome.runtime.MessageSender) => void | Promise<void>;

export function onMessage(listener: Listener): () => void {
  const handler = (raw: unknown, sender: chrome.runtime.MessageSender, send: () => void) => {
    const msg = parseExtMessage(raw);
    if (!msg) return;
    Promise.resolve(listener(msg, sender)).finally(() => send());
    return true;
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

/** Send a message to the service worker (any extension surface -> background). */
export async function sendToBackground(msg: ExtMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch (err) {
    // service worker may have been suspended; Chrome wakes it on next attempt.
    console.debug('[EmailSignal] sendToBackground swallow', err);
  }
}

export async function sendToActiveTab(msg: ExtMessage): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch (err) {
    console.debug('[EmailSignal] sendToActiveTab swallow', err);
  }
}

export async function sendToTab(tabId: number, msg: ExtMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (err) {
    console.debug('[EmailSignal] sendToTab swallow', err);
  }
}
