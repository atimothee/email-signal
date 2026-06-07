import {
  ClutterFinding,
  ClutterFindingSchema,
  Decision,
  DecisionSchema,
  EmailCandidate,
  AgentTraceEventSchema,
  UserPreference,
} from '@schemas/index';
import { AGENT_NAMES } from './agent-defs';
import { recordTrace } from '@/weave/tracing';
import { sseFetch, isServerHealthy } from '@/common/server-client';
import { getOpenAIKey } from './runtime';
import { STORAGE_KEYS } from '@/common/constants';
import { AccountIdentitySchema } from '@schemas/index';

/**
 * The signed-in mail address (scraped, no OAuth). Sent to the sidecar only to
 * namespace its classify cache so two accounts never share cached results.
 * Returns undefined when no account has been scraped yet.
 */
async function getAccountEmail(): Promise<string | undefined> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return undefined;
  const v = await chrome.storage.local.get(STORAGE_KEYS.account);
  const parsed = AccountIdentitySchema.safeParse(v[STORAGE_KEYS.account]);
  return parsed.success ? parsed.data.email : undefined;
}

/**
 * The extension is a THIN client. All intelligence — clutter classification and
 * decision synthesis — runs in the Node sidecar via the OpenAI Agents SDK. The
 * extension never calls OpenAI directly and never classifies anything itself.
 *
 * The sidecar is REQUIRED. If it is unreachable, or no OpenAI key is available
 * (neither forwarded from Settings nor in server/.env), we throw a SidecarError
 * with a user-facing message — there is no local fallback.
 */
export class SidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SidecarError';
  }
}

export interface ClassifyResult {
  clutter: ClutterFinding[];
  decisions: Decision[];
  /** One-sentence "here's your day" synthesis from the sidecar, '' if nothing. */
  summary: string;
}

async function preflight(): Promise<string | undefined> {
  const key = (await getOpenAIKey()) ?? undefined;
  const health = await isServerHealthy();
  if (!health.ok) {
    throw new SidecarError(
      `Can't reach the Email Signal sidecar (${health.error ?? 'offline'}). ` +
        `Start it with "npm run server" in the repo, or set the URL in Settings.`
    );
  }
  if (!health.info?.hasOpenAIKey && !key) {
    throw new SidecarError(
      'The sidecar is running but has no OpenAI API key. Add one in Settings ' +
        '(it is sent to your sidecar) or in server/.env, then scan again.'
    );
  }
  return key;
}

/** Classify + synthesize a full candidate set through the sidecar. */
export async function classifyViaSidecar(
  turnId: string,
  candidates: EmailCandidate[],
  preferences?: UserPreference[]
): Promise<ClassifyResult> {
  const apiKey = await preflight();
  const account = await getAccountEmail();
  const clutter: ClutterFinding[] = [];
  const decisions: Decision[] = [];
  let summary = '';

  for await (const ev of sseFetch('/orchestrate/classify', {
    turnId,
    candidates,
    apiKey,
    account,
    preferences,
  })) {
    if (ev.type === 'trace') {
      const parsed = AgentTraceEventSchema.safeParse(ev.data);
      if (parsed.success) await recordTrace(parsed.data);
    } else if (ev.type === 'classification') {
      for (const f of ev.data.clutter ?? []) {
        const r = ClutterFindingSchema.safeParse(f);
        if (r.success) clutter.push(r.data);
      }
    } else if (ev.type === 'decisions') {
      for (const d of ev.data.decisions ?? []) {
        const r = DecisionSchema.safeParse(d);
        if (r.success) decisions.push(r.data);
      }
      if (typeof ev.data.summary === 'string') summary = ev.data.summary;
    } else if (ev.type === 'error') {
      await recordTrace({
        kind: 'error',
        agent: AGENT_NAMES.orchestrator,
        turnId,
        message: ev.data.message,
      });
      throw new SidecarError(ev.data.message);
    }
  }

  return { clutter, decisions, summary };
}

/** Ask the sidecar a chat question about the inbox. */
export async function chatViaSidecar(
  turnId: string,
  userMessage: string,
  context?: { recentClutter?: ClutterFinding[]; recentDecisions?: Decision[] }
): Promise<string> {
  const apiKey = await preflight();
  let text: string | undefined;
  for await (const ev of sseFetch('/orchestrate/chat', {
    turnId,
    message: userMessage,
    apiKey,
    context,
  })) {
    if (ev.type === 'trace') {
      const parsed = AgentTraceEventSchema.safeParse(ev.data);
      if (parsed.success) await recordTrace(parsed.data);
    } else if (ev.type === 'chat_reply') {
      text = ev.data.text;
    } else if (ev.type === 'error') {
      throw new SidecarError(ev.data.message);
    }
  }
  return text ?? '…';
}
