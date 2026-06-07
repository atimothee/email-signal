import { STORAGE_KEYS } from '@/common/constants';
import { AccountIdentitySchema } from '@schemas/index';

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

/** The overridable config forwarded to the sidecar in each request body. */
export interface ClientSettings {
  apiKey?: string;
  model?: string;
  wandbApiKey?: string;
  wandbProject?: string;
}

/**
 * Gather all four Settings-first overrides (OpenAI key, chat model, Weave
 * key/project) to forward to the sidecar. Blank fields are dropped so an empty
 * Settings input never shadows server/.env — the sidecar resolves each value
 * Settings → env → default. In Node (evals) we read the matching process.env.
 */
export async function getClientSettings(): Promise<ClientSettings> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const v = await chrome.storage.local.get([
      STORAGE_KEYS.apiKey,
      STORAGE_KEYS.model,
      STORAGE_KEYS.wandbApiKey,
      STORAGE_KEYS.wandbProject,
    ]);
    const out: ClientSettings = {};
    const apiKey = (v[STORAGE_KEYS.apiKey] as string | undefined)?.trim();
    const model = (v[STORAGE_KEYS.model] as string | undefined)?.trim();
    const wandbApiKey = (v[STORAGE_KEYS.wandbApiKey] as string | undefined)?.trim();
    const wandbProject = (v[STORAGE_KEYS.wandbProject] as string | undefined)?.trim();
    if (apiKey) out.apiKey = apiKey;
    if (model) out.model = model;
    if (wandbApiKey) out.wandbApiKey = wandbApiKey;
    if (wandbProject) out.wandbProject = wandbProject;
    return out;
  }
  const out: ClientSettings = {};
  const apiKey = process.env['OPENAI_API_KEY']?.trim();
  const model = process.env['EMAIL_SIGNAL_MODEL']?.trim();
  const wandbApiKey = process.env['WANDB_API_KEY']?.trim();
  const wandbProject = process.env['WANDB_PROJECT']?.trim();
  if (apiKey) out.apiKey = apiKey;
  if (model) out.model = model;
  if (wandbApiKey) out.wandbApiKey = wandbApiKey;
  if (wandbProject) out.wandbProject = wandbProject;
  return out;
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

/**
 * Fallback account id used before any inbox is connected, and in Node contexts
 * (evals/scripts) where there is no DOM to scrape. Was the only id pre-#5.
 */
export const USER_ID = 'local-user';

/**
 * Derive a stable, storage-safe account id from a connected mail identity
 * (issue #5). `provider:email` is stable across sessions and unique per inbox,
 * so memory/ledger partition cleanly without any OAuth/account-number scrape.
 */
export function accountIdFor(identity: { provider: string; email: string }): string {
  return `${identity.provider}:${identity.email.trim().toLowerCase()}`;
}

/**
 * The active account id that memory and the ledger are partitioned by. Reads
 * the connected identity (es.account.v1, written by the content scraper); before
 * any inbox is connected — or in Node eval contexts — falls back to USER_ID so
 * everything keeps working single-user. Kill switch / dry-run stay global and do
 * NOT go through here (safety defaults must not fragment per account).
 */
export async function getAccountId(): Promise<string> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const v = await chrome.storage.local.get(STORAGE_KEYS.account);
    const parsed = AccountIdentitySchema.safeParse(v[STORAGE_KEYS.account]);
    return parsed.success ? accountIdFor(parsed.data) : USER_ID;
  }
  return process.env['EMAIL_SIGNAL_ACCOUNT_ID']?.trim() || USER_ID;
}
