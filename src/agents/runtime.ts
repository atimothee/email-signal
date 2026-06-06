import { STORAGE_KEYS } from '@/common/constants';

/**
 * Resolve the OpenAI API key + runtime flags. In the extension we look in
 * chrome.storage.local (user pastes it in the Settings tab). In Node
 * contexts (evals, optional server), we read process.env.
 */
export async function getOpenAIKey(): Promise<string | null> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const v = await chrome.storage.local.get(STORAGE_KEYS.apiKey);
    return (v[STORAGE_KEYS.apiKey] as string | undefined) ?? null;
  }
  return process.env['OPENAI_API_KEY'] ?? null;
}

export async function isDryRun(): Promise<boolean> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const v = await chrome.storage.local.get(STORAGE_KEYS.dryRun);
    const stored = v[STORAGE_KEYS.dryRun];
    return stored === undefined ? true : !!stored;
  }
  return (process.env['EMAIL_SIGNAL_DRY_RUN'] ?? 'true') !== 'false';
}

export async function isKillSwitchOn(): Promise<boolean> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const v = await chrome.storage.local.get(STORAGE_KEYS.killSwitch);
    return !!v[STORAGE_KEYS.killSwitch];
  }
  return false;
}

export const USER_ID = 'local-user'; // V1: single-user local extension
