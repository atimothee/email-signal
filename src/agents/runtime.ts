import { STORAGE_KEYS } from '@/common/constants';

/**
 * Resolve the OpenAI API key the user pasted in Settings. It is forwarded to the
 * sidecar (which uses it with the Agents SDK); the extension never calls OpenAI
 * directly. In Node contexts (evals) we read process.env.
 */
export async function getOpenAIKey(): Promise<string | null> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const v = await chrome.storage.local.get(STORAGE_KEYS.apiKey);
    const k = (v[STORAGE_KEYS.apiKey] as string | undefined)?.trim();
    return k ? k : null;
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
