/// <reference types="node" />

/**
 * Single source of truth for resolving runtime config that the extension can
 * override. Precedence is uniform everywhere:
 *
 *   extension setting (if non-empty) → process.env → built-in default
 *
 * This generalizes the pattern that already worked for the OpenAI key (forwarded
 * from Settings in the request body, falling back to server/.env). The change is
 * strictly additive: with empty Settings, every value resolves to exactly the
 * env/default it used before.
 *
 * Only the four user-overridable variables live here. Server-internal knobs
 * (REDIS_URL, ports, cache TTL, dedup threshold, batch/embed model, dry-run/
 * notify) stay env-only and are read at their own call sites.
 */

/** The overridable settings the extension forwards in each request body. */
export interface ClientSettings {
  apiKey?: string;
  model?: string;
  wandbApiKey?: string;
  wandbProject?: string;
}

export const DEFAULT_MODEL = 'gpt-4.1-mini';
export const DEFAULT_WANDB_PROJECT = 'email-signal';

export interface ResolvedConfig {
  openaiKey: string | undefined;
  model: string;
  /**
   * Model for the judgment-heavy stages (decision synthesis, cross-batch
   * consolidation, the demote/resolve verifier). Defaults to `model`, but can be
   * pointed at a stronger model via `EMAIL_SIGNAL_SYNTHESIS_MODEL` so the cheap
   * bulk classifier and the reasoning passes can use different tiers.
   */
  synthesisModel: string;
  wandbApiKey: string | undefined;
  wandbProject: string;
}

/**
 * Resolve effective config from the (optional) forwarded extension settings,
 * falling back to env then built-in defaults. A blank/whitespace setting is
 * treated as absent so an empty Settings field never shadows server/.env.
 */
export function resolveConfig(settings?: ClientSettings): ResolvedConfig {
  const model = settings?.model?.trim() || process.env['EMAIL_SIGNAL_MODEL'] || DEFAULT_MODEL;
  return {
    openaiKey: settings?.apiKey?.trim() || process.env['OPENAI_API_KEY'] || undefined,
    model,
    // Falls back to the bulk model so existing setups are unchanged; set
    // EMAIL_SIGNAL_SYNTHESIS_MODEL to give the reasoning passes a stronger tier.
    synthesisModel: process.env['EMAIL_SIGNAL_SYNTHESIS_MODEL']?.trim() || model,
    wandbApiKey: settings?.wandbApiKey?.trim() || process.env['WANDB_API_KEY'] || undefined,
    wandbProject:
      settings?.wandbProject?.trim() || process.env['WANDB_PROJECT'] || DEFAULT_WANDB_PROJECT,
  };
}

/**
 * Resolve the OpenAI key or throw the user-facing error. Same message the old
 * `ensureKey` used so the extension's existing copy stays accurate.
 */
export function requireOpenAIKey(settings?: ClientSettings): string {
  const key = resolveConfig(settings).openaiKey;
  if (!key) {
    throw new Error(
      'No OpenAI API key. Add one in the extension Settings (it is sent to this sidecar) or in server/.env.'
    );
  }
  return key;
}
