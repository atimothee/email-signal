import { Agent, run, setDefaultOpenAIKey } from '@openai/agents';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  ClutterFindingSchema,
  EmailCandidate,
  ClutterFinding,
  Decision,
  DecisionSchema,
  UserPreference,
} from '../src/schemas/index.js';
import { AGENT_NAMES, INSTRUCTIONS } from '../src/agents/agent-defs.js';
import { resolveSenderName, domainOf } from '../src/common/sender.js';
import { emit, SseWriter } from './trace-bridge.js';
import {
  classifyCacheKey,
  getCachedClassification,
  setCachedClassification,
} from './cache.js';
import { reconcilePreferences } from './memory.js';
import { dedupDecisions } from './dedup.js';
import {
  ClientSettings,
  DEFAULT_WANDB_PROJECT,
  resolveConfig,
  requireOpenAIKey,
} from './config.js';

/** Max candidates per parallel classifier call. */
const BATCH_SIZE = Number(process.env['EMAIL_SIGNAL_BATCH_SIZE'] ?? 25);
/** Max decisions we ever return — the whole point is a short list. */
const MAX_DECISIONS = 8;

let weaveReady = false;
/**
 * The imported `weave` module, kept after a successful `init` so `traced()` can
 * reach `weave.op` without re-importing. Null until (and unless) init succeeds.
 */
let weaveMod: typeof import('weave') | null = null;

/**
 * Wraps a `run()` call so its outcome shape matches Promise.allSettled,
 * keeping the result-handling code below uniform.
 */
async function runSafe<T>(
  fn: () => Promise<T>
): Promise<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: any }> {
  try {
    const value = await fn();
    return { status: 'fulfilled', value };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

function formatRunError(err: any): string {
  if (!err) return 'unknown error';
  const parts: string[] = [];
  parts.push(err.message ?? String(err));
  if (err.cause) parts.push(`cause: ${err.cause.message ?? String(err.cause)}`);
  if (err.data) parts.push(`data: ${safeJson(err.data)}`);
  if (err.issues) parts.push(`zod: ${safeJson(err.issues)}`);
  return parts.join(' | ').slice(0, 600);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export async function initServerWeave(): Promise<void> {
  // Boot-time init from env only (extension hasn't talked to us yet).
  await ensureServerWeave();
}

/**
 * Initialize Weave once, lazily, from either a forwarded key/project (extension
 * Settings) or the server env. Idempotent: if Weave is already up this returns
 * immediately and does NOT hot-swap — hot-swapping the Weave project mid-process
 * is not supported, so the FIRST key/project to initialize wins; restart the
 * server to change it. Best-effort: never throws (tracing must not break a run).
 */
export async function ensureServerWeave(
  wandbApiKey?: string,
  wandbProject?: string
): Promise<void> {
  if (weaveReady) return;
  const cfg = resolveConfig({ wandbApiKey, wandbProject });
  const apiKey = cfg.wandbApiKey;
  if (!apiKey) return; // tracing disabled silently
  try {
    const weave = await import('weave');
    const project = cfg.wandbProject;
    // The weave JS SDK authenticates from ~/.netrc, NOT from WANDB_API_KEY in the
    // environment — so an env-only key makes init() throw "Could not find entry in
    // netrc file". Log in explicitly with the key first (it writes the netrc).
    await weave.login(apiKey);
    await weave.init(project);
    weaveMod = weave;
    weaveReady = true;
    // eslint-disable-next-line no-console
    console.log(`[emailsignal-server] Weave initialized for project "${project}"`);
    // eslint-disable-next-line no-console
    console.log(`[emailsignal-server] Weave dashboard: ${weaveDashboardUrl()}`);
  } catch (err) {
    console.warn('[emailsignal-server] weave init failed', err);
  }
}

/**
 * Best-effort Weave dashboard URL for the configured project. W&B traces live at
 * `https://wandb.ai/<entity>/<project>/weave`. We don't reliably know the entity
 * here (it's resolved from the API key at init time), so when WANDB_PROJECT is in
 * `entity/project` form we use it verbatim; otherwise we omit the entity and let
 * W&B resolve the default one. Returns null when tracing isn't configured.
 */
export function weaveDashboardUrl(): string | null {
  if (!process.env['WANDB_API_KEY']) return null;
  const project = process.env['WANDB_PROJECT'] ?? DEFAULT_WANDB_PROJECT;
  return `https://wandb.ai/${project}/weave`;
}

/**
 * Wrap an async thunk as a named Weave op so it shows up in the W&B dashboard
 * with its inputs/outputs. When Weave isn't initialized (no WANDB_API_KEY) this
 * is a transparent pass-through: the thunk is just awaited, zero overhead.
 *
 * We `op()`-ify a fresh closure per call (cheap) rather than caching, because the
 * captured `input` is what Weave records as the op's argument — giving each run
 * site a distinct, inspectable trace.
 */
async function traced<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  if (!weaveReady || !weaveMod) return fn();
  // weave.op(fn, { name }) returns a wrapped fn that auto-tracks the call.
  // Signature (from weave 0.7 op.d.ts):
  //   op<T>(fn: T, options?: { name?: string; ... }): Op<(...args) => Promise<...>>
  const wrapped = weaveMod.op(async (_input: unknown) => fn(), { name });
  return wrapped(input);
}

/**
 * Resolve the OpenAI key for this run and install it for the Agents SDK. The
 * extension forwards the key the user pasted in Settings; we fall back to the
 * server's own env (see resolveConfig). The key is only ever used here, with the
 * `@openai/agents` SDK — never sent anywhere else.
 */
function ensureKey(settings?: ClientSettings): void {
  setDefaultOpenAIKey(requireOpenAIKey(settings));
}

// ---- Shared schemas ----
const ClutterBatchSchema = z.object({ findings: z.array(ClutterFindingSchema) });

const DecisionThemeEnum = z.enum([
  'money', 'reply', 'schedule', 'job', 'travel', 'admin', 'security', 'other',
]);
const DecisionUrgencyEnum = z.enum(['critical', 'high', 'normal', 'low']);
const DecisionActionKindEnum = z.enum(['reply', 'pay', 'open', 'schedule', 'review', 'none']);

/** SDK output shape for the synthesizer (strict-friendly: nullable, not optional). */
const DecisionOutSchema = z.object({
  title: z.string(),
  why: z.string(),
  theme: DecisionThemeEnum,
  urgency: DecisionUrgencyEnum,
  emailIds: z.array(z.string()),
  senders: z.array(z.string()),
  dueAt: z.string().nullable(),
  action: z.object({ label: z.string(), kind: DecisionActionKindEnum }).nullable(),
  confidence: z.number(),
  // ── Temporal intelligence (model-provided) ──
  // The action's time character so the server can rank/demote by age correctly.
  windowType: z.enum(['deadline', 'event', 'standing', 'none']),
  // True ONLY on explicit in-thread evidence the action is already done.
  resolved: z.boolean(),
});
const DecisionBatchSchema = z.object({ decisions: z.array(DecisionOutSchema) });
export type DecisionOut = z.infer<typeof DecisionOutSchema>;

interface ClassifyInput {
  turnId: string;
  candidates: EmailCandidate[];
  writer: SseWriter;
  /**
   * Overridable config forwarded from the extension Settings (OpenAI key, model,
   * Weave key/project). Each field falls back to server env then a default via
   * resolveConfig; absent/empty Settings reproduce the env-only behavior exactly.
   */
  settings?: ClientSettings;
  /**
   * Signed-in mail account (scraped from the Gmail DOM, no OAuth). Used only to
   * namespace the classify cache so two accounts on one Redis never mix. Hashed
   * before it touches Redis — never stored in the clear.
   */
  account?: string;
  /**
   * User preferences recalled client-side (chrome.storage). Merged with the
   * account's Redis-stored preferences and fed into synthesis so the user's
   * standing instructions ("ignore this sender", "this topic matters") shape the
   * decisions. Also folded into the cache key so a preference change busts it.
   */
  preferences?: UserPreference[];
}

export interface ClassifyOutput {
  clutter: ClutterFinding[];
  decisions: Decision[];
  /**
   * One-sentence "here's your day" line in the user's voice, synthesized across
   * the FINAL decisions. Always a string: '' when there are no decisions or when
   * the summary call fails (we never let a summary error break the decisions flow).
   */
  summary: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length === 0 ? [[]] : out;
}

function buildClutterAgent(model: string): Agent<unknown, typeof ClutterBatchSchema> {
  return new Agent({
    name: AGENT_NAMES.clutter,
    instructions: INSTRUCTIONS[AGENT_NAMES.clutter],
    model,
    outputType: ClutterBatchSchema,
  });
}

const DECISION_INSTRUCTIONS = `You are EmailSignal's decision synthesizer. Read a batch of emails and extract the SIGNAL: the short list of things the user actually needs to act on. You are NOT a second inbox — never restate what Gmail already shows.

Return STRICT JSON matching the schema: { "decisions": Decision[] }.

A Decision is ONE thing the user must do, and may fold together MULTIPLE related emails (two recruiters waiting → ONE decision; a thread of replies → ONE decision):
  - title: verb-led, in the user's voice ("Reply to Maya about Friday lunch", "Pay Absa R1,240 by the 15th"). NOT a category, NOT the raw subject.
  - why: one short sentence on why it matters.
  - theme: money | reply | schedule | job | travel | admin | security | other.
  - urgency: critical | high | normal | low.

THEME GUIDE (pick by what the email is ABOUT, not by a keyword it happens to contain):
  - money: a real bill, invoice, payment, refund, or payout.
  - reply: a person is waiting on a written response from the user.
  - schedule: arranging a meeting/call/event or a calendar invite.
  - job: EMPLOYMENT and the user's CAREER only — recruiters, applications, interviews, offers, HR. NOT engineering work. A CI/CD "deploy job", "build job", or "cron job" is NOT this theme.
  - travel: flights, hotels, check-ins, itineraries.
  - admin: operational and TECHNICAL tasks — deployment/build/CI failures (Vercel, Netlify, GitHub Actions, etc.), service/infra alerts, account and settings changes, domain/DNS, subscriptions. "Fix the deployment error" is admin.
  - security: sign-in alerts, password resets, 2FA, suspicious-activity warnings, breach notices.
  - other: a genuine action that fits none of the above.
  - emailIds: ids of every email folded into this decision (from the input).
  - senders: friendly sender names provided in the input — NEVER a raw address, NEVER "noreply".
  - dueAt: ISO date if a real deadline exists, else null.
  - action: { label, kind } with kind ∈ reply|pay|open|schedule|review|none, label a verb-led button — or null.
  - confidence: 0..1.
  - windowType: deadline | event | standing | none (see TIME below).
  - resolved: true | false (see TIME below).

TIME (reason about WHEN — recency is not relevance, so classify the action's time character):
  - windowType:
      • 'deadline' — something is still OWED or DUE BY a date and stays open until it's done. An overdue bill is MORE urgent, not less. (pay a bill, file a form, return a signed doc.) A RECEIPT, CONFIRMATION, ORDER, or "your trip"/"your ride" record of an ALREADY-CHARGED transaction is NOT a deadline and has NO dueAt — the money already moved, there is nothing to pay. Do not read the transaction/trip date as a due date. Only a still-OPEN, UNPAID obligation gets windowType='deadline' and a dueAt.
      • 'event' — a single moment that simply PASSES: a viewing, flight, call, meeting, RSVP-by-time. Once that moment is past, the action is DEAD.
      • 'standing' — a real action with no date attached.
      • 'none' — no time character / unclear.
  - resolved: set TRUE only on EXPLICIT in-thread evidence the action is already done — a later "paid" / "confirmed" / "thanks, done", or the user's OWN sent reply in the thread. Absence of evidence is NOT resolution; default to false.
  - dueAt: resolve relative dates ('tomorrow', 'next Tue', 'the 15th') against THAT email's receivedAt and TODAY (given in the temporal frame). Emit an ISO date, or null if there is no real deadline.
  - HEDGE the 'why' when something LOOKS urgent but is OLD or LIKELY ALREADY PAST. Name the tension out loud, e.g. "Sender marked it urgent, but it's from March — likely already past." or "Flagged as your final notice, but the date was last week — probably handled already." A 'deadline' whose date is well in the past with no recent follow-up email should be hedged as PROBABLY ALREADY HANDLED, never framed as freshly urgent. Naming that tension is the whole point.

HARD RULES (these are the exact mistakes to avoid):
  - A bank/account/insurance STATEMENT is NOT a payment reminder unless there is a real amount due AND an action to pay by a date. Otherwise theme=admin, low urgency — or omit it.
  - A RECEIPT / CONFIRMATION / ORDER / trip-or-ride summary for a transaction that was ALREADY CHARGED is NOT an unpaid bill: do NOT emit a dueAt, do NOT set windowType='deadline', and do NOT title it "Pay …". The charge is done. At most it is a low-urgency admin FYI — and usually it should simply be OMITTED.
  - Marketing/cold/bulk mail that opens "Hi {name/city}" does NOT need a reply.
  - Newsletters, promotions, notifications, social updates are NEVER decisions — omit them entirely.
  - Prefer FEW, high-confidence decisions. If nothing genuinely needs the user, return an empty list. NEVER pad.`;

function buildDecisionAgent(model: string): Agent<unknown, typeof DecisionBatchSchema> {
  return new Agent({
    name: 'DecisionSynthesizerAgent',
    instructions: DECISION_INSTRUCTIONS,
    model,
    outputType: DecisionBatchSchema,
  });
}

const DAY_SUMMARY_INSTRUCTIONS = `You write ONE sentence — the user's "here's your day" line — from the SHORT list of decisions (things they actually need to act on) below.

Speak in the user's own voice, plain and natural, the way a sharp assistant would in one breath. Synthesize across the whole list; pull out what's heaviest (money owed, someone waiting, a deadline) rather than listing everything.

Return STRICT JSON: { "summary": string }.

Examples of the tone:
  - "Three money decisions and a recruiter's been waiting two days — the rest is quiet."
  - "Just Maya waiting on a lunch reply."
  - "A bill due Friday and an interview to confirm."

HARD RULES:
  - ONE sentence, ≤ 160 characters.
  - Plain language. No agent names, no jargon, no "the user", no robotic counts like "You have 3 items".
  - Summarize only these DECISIONS — never mention newsletters, promotions, or clutter.
  - Be HONEST: never invent activity or pad. If the list is short, the line is short.`;

const DaySummarySchema = z.object({ summary: z.string() });

function buildDaySummaryAgent(model: string): Agent<unknown, typeof DaySummarySchema> {
  return new Agent({
    name: 'DaySummaryAgent',
    instructions: DAY_SUMMARY_INSTRUCTIONS,
    model,
    outputType: DaySummarySchema,
  });
}

/**
 * One small LLM call over the FINAL decision list to produce the "here's your
 * day" line. Honest by construction: 0 decisions → '' (no call, no invented
 * activity). Fully defensive — any failure degrades to '' and never throws, so a
 * summary problem can never break the decisions flow.
 */
async function summarizeDay(decisions: Decision[], model: string): Promise<string> {
  if (decisions.length === 0) return '';
  try {
    const slim = decisions.map((d) => ({
      title: d.title,
      why: d.why,
      theme: d.theme,
      urgency: d.urgency,
      senders: d.senders,
      dueAt: d.dueAt,
    }));
    const result = await traced(
      'email_signal.day_summary',
      { decisions: decisions.length },
      () =>
        run(
          buildDaySummaryAgent(model),
          `Write the user's one-sentence day summary from these decisions. Return {summary: string} only.\n${JSON.stringify(slim)}`
        )
    );
    const raw = (result.finalOutput as { summary?: unknown } | undefined)?.summary;
    if (typeof raw !== 'string') return '';
    // Enforce the contract bounds defensively (one line, ≤160 chars).
    return raw.replace(/\s+/g, ' ').trim().slice(0, 160);
  } catch {
    return '';
  }
}

/**
 * Full classification + synthesis, entirely server-side via the Agents SDK.
 *
 *  1. ClutterClassifierAgent labels low-signal mail (parallel batches).
 *  2. DecisionSynthesizerAgent turns the remaining (signal) mail into a SHORT
 *     list of decisions, collapsing related emails. A consolidation pass merges
 *     across batches when needed.
 *
 * Display fields (sender names, domains) are resolved here so the extension is a
 * thin renderer — no intelligence runs in the browser.
 */
export async function runAgentClassification(input: ClassifyInput): Promise<ClassifyOutput> {
  const cfg = resolveConfig(input.settings);
  ensureKey(input.settings);
  // Initialize Weave on first run if a key is available (override or env). No-op
  // and never throws once ready / when no key — tracing must never break a run.
  await ensureServerWeave(cfg.wandbApiKey, cfg.wandbProject).catch(() => {});
  const sessionId = nanoid();
  const { turnId, candidates, writer, account } = input;
  // Anchor "now" once for the whole scan: the model's temporal frame and all
  // server-side recency/demotion math resolve against this single timestamp.
  const now = new Date();
  const frame = temporalFrame(now);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const friendlyName = (id: string): string => {
    const c = byId.get(id);
    return c ? resolveSenderName(c.from, domainOf(c.from.email)) : 'Unknown sender';
  };

  // ── 0) Agent Memory: recall + merge the user's preferences ──
  // The client forwards what it has (chrome.storage); we union that with the
  // account's Redis-stored preferences (cross-device) and mirror new ones back.
  // The merged set both feeds synthesis and fingerprints the cache key.
  const preferences = await reconcilePreferences(account, input.preferences ?? []);

  // ── 1) Exact-match cache ──
  // A rescan of an unchanged inbox under unchanged preferences is the same
  // (account, id-set, prefs) → replay the derived result instead of re-running
  // ~20 OpenAI calls. Miss/disabled → fall straight through to the live pipeline.
  const cacheKey = classifyCacheKey(account, candidates, preferences);
  const cached = await getCachedClassification(cacheKey);
  if (cached) {
    await emit(writer, sessionId, turnId, {
      kind: 'session_start',
      message: `Reusing cached analysis of ${candidates.length} emails`,
    });
    await emit(writer, sessionId, turnId, {
      kind: 'agent_end',
      agent: AGENT_NAMES.orchestrator,
      message: `cache hit — ${cached.decisions.length} decision(s), ${cached.clutter.length} clutter (no LLM calls)`,
    });
    await emit(writer, sessionId, turnId, { kind: 'session_end' });
    // The cache stores only { clutter, decisions }; recompute the one-sentence
    // day summary over the cached ACTIVE (non-demoted) decisions (cheap, honest,
    // degrades to ''). Cached decisions already carry their demoted flag.
    return { ...cached, summary: await summarizeDay(cached.decisions.filter((d) => !d.demoted), cfg.model) };
  }

  await emit(writer, sessionId, turnId, {
    kind: 'session_start',
    message: `Classifying ${candidates.length} candidates`,
  });

  const clutterAgent = buildClutterAgent(cfg.model);
  const decisionAgent = buildDecisionAgent(cfg.model);

  // ── 1) Clutter, in parallel batches ──
  const clutterBatches = chunk(candidates, BATCH_SIZE);
  await emit(writer, sessionId, turnId, {
    kind: 'agent_start',
    agent: AGENT_NAMES.orchestrator,
    message: `dispatching ${clutterBatches.length} clutter batch(es)`,
  });
  for (let i = 0; i < clutterBatches.length; i++) {
    await emit(writer, sessionId, turnId, {
      kind: 'agent_handoff',
      agent: AGENT_NAMES.orchestrator,
      message: `${AGENT_NAMES.orchestrator} → ${AGENT_NAMES.clutter}: classify_clutter`,
      data: { fromAgent: AGENT_NAMES.orchestrator, toAgent: AGENT_NAMES.clutter, kind: 'classify_clutter', batchIndex: i, batchCount: clutterBatches.length },
    });
  }

  const clutterSettled = await Promise.allSettled(
    clutterBatches.map((batch, idx) =>
      traced('email_signal.classify_clutter', { batchIndex: idx, batchSize: batch.length },
        () => run(clutterAgent, `${frame}Classify these EmailCandidates and return {findings: ClutterFinding[]} only.\n${slimForClutter(batch)}`))
        .catch((reason) => {
          void emit(writer, sessionId, turnId, { kind: 'error', agent: AGENT_NAMES.clutter, message: `clutter batch ${idx + 1}: ${formatRunError(reason)}` });
          throw reason;
        })
    )
  );

  // If any batch rejected, the assembled result is incomplete — we must NOT
  // persist it (a transient failure would otherwise be cached for the full TTL).
  let degraded = clutterSettled.some((r) => r.status === 'rejected');

  const clutter: ClutterFinding[] = [];
  for (const r of clutterSettled) {
    if (r.status !== 'fulfilled') continue;
    const findings = (r.value.finalOutput as { findings?: ClutterFinding[] } | undefined)?.findings ?? [];
    for (const f of findings) {
      const hydrated = hydrateClutter(f, byId);
      if (hydrated) clutter.push(hydrated);
    }
  }
  await emit(writer, sessionId, turnId, { kind: 'agent_end', agent: AGENT_NAMES.clutter, message: `clutter findings: ${clutter.length}` });

  // ── 2) Synthesis over the SIGNAL candidates ──
  // Only DEFINITE noise is removed before synthesis. Ambiguous categories
  // (other / receipt / repeat-sender) stay in — the synthesizer itself decides
  // whether they're a real decision, so a personal note never gets buried by an
  // over-eager clutter label.
  const NOISE_CATEGORIES = new Set([
    'promotion', 'newsletter', 'marketing', 'cold_outreach', 'automated_notification', 'social_update',
  ]);
  const noiseIds = new Set(clutter.filter((f) => NOISE_CATEGORIES.has(f.category)).map((f) => f.emailId));
  const signal = candidates.filter((c) => !noiseIds.has(c.id));

  const prefsBlock = formatPreferencesForSynthesis(preferences);

  let drafts: DecisionOut[] = [];
  if (signal.length > 0) {
    const decisionBatches = chunk(signal, BATCH_SIZE);
    for (let i = 0; i < decisionBatches.length; i++) {
      await emit(writer, sessionId, turnId, {
        kind: 'agent_handoff',
        agent: AGENT_NAMES.orchestrator,
        message: `${AGENT_NAMES.orchestrator} → DecisionSynthesizerAgent: synthesize`,
        data: { fromAgent: AGENT_NAMES.orchestrator, toAgent: 'DecisionSynthesizerAgent', kind: 'classify_priority', batchIndex: i, batchCount: decisionBatches.length },
      });
    }
    const settled = await Promise.allSettled(
      decisionBatches.map((batch, idx) =>
        traced('email_signal.synthesize_decisions', { batchIndex: idx, batchSize: batch.length },
          () => run(decisionAgent, `${frame}Synthesize decisions from these emails. Return {decisions: Decision[]} only.${prefsBlock}\n${slimForDecisions(batch, friendlyName)}`))
          .catch((reason) => {
            void emit(writer, sessionId, turnId, { kind: 'error', agent: 'DecisionSynthesizerAgent', message: `synthesis batch ${idx + 1}: ${formatRunError(reason)}` });
            throw reason;
          })
      )
    );
    if (settled.some((r) => r.status === 'rejected')) degraded = true;
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        drafts.push(...((r.value.finalOutput as { decisions?: DecisionOut[] } | undefined)?.decisions ?? []));
      }
    }

    // Cross-batch consolidation when we have more than a short list. Prefer
    // vector dedup (embed + cluster + deterministic merge) — ~100× cheaper than
    // a consolidation LLM call and reproducible. Fall back to the LLM merge only
    // when embeddings are unavailable.
    if (drafts.length > MAX_DECISIONS) {
      const deduped = await dedupDecisions(drafts, cfg.openaiKey);
      if (deduped.clustered && deduped.merged.length) {
        await emit(writer, sessionId, turnId, {
          kind: 'agent_end',
          agent: 'DecisionSynthesizerAgent',
          message: `vector dedup: ${drafts.length} drafts → ${deduped.merged.length} (no LLM)`,
        });
        drafts = deduped.merged;
      } else {
        const cons = await runSafe(() =>
          traced('email_signal.consolidate_decisions', { drafts: drafts.length },
            () => run(decisionAgent, `These draft decisions came from different batches of ONE inbox. Merge duplicates/related ones (same sender + same ask), keep the union of emailIds, and return the TOP ${MAX_DECISIONS} as {decisions: Decision[]}. Drop weak ones rather than padding.\n${JSON.stringify(drafts)}`))
        );
        if (cons.status === 'fulfilled') {
          const merged = (cons.value.finalOutput as { decisions?: DecisionOut[] } | undefined)?.decisions;
          if (merged && merged.length) drafts = merged;
        }
      }
    }
  }

  const decisions = hydrateDecisions(drafts, byId, friendlyName, now);
  await emit(writer, sessionId, turnId, { kind: 'agent_end', agent: 'DecisionSynthesizerAgent', message: `decisions: ${decisions.length}` });

  // One-sentence "here's your day" line over the ACTIVE (non-demoted) decisions
  // only — demoted items are "likely past — handled?", so they must not colour
  // the day summary. Honest: '' when nothing is active. Never throws — a summary
  // failure degrades to '' (see summarizeDay).
  const summary = await summarizeDay(decisions.filter((d) => !d.demoted), cfg.model);

  // Persist the derived result so the next identical scan is a cache hit — but
  // ONLY when every batch succeeded. Caching a partially-failed run would replay
  // an under-classified inbox for the whole TTL.
  const result: ClassifyOutput = { clutter, decisions, summary };
  if (!degraded) {
    await setCachedClassification(cacheKey, result);
  } else {
    await emit(writer, sessionId, turnId, {
      kind: 'agent_end',
      agent: AGENT_NAMES.orchestrator,
      message: 'result not cached — a batch failed, so the run is incomplete',
    });
  }

  await emit(writer, sessionId, turnId, { kind: 'session_end' });
  return result;
}

// ── preferences → synthesis directive ──

/**
 * Turn the user's standing preferences into a compact instruction block the
 * synthesizer must honour. Returns '' when there are none, so the prompt is
 * unchanged for users who've set nothing.
 */
function formatPreferencesForSynthesis(prefs: UserPreference[]): string {
  if (!prefs.length) return '';
  const byKind = (kind: UserPreference['kind']): string[] =>
    prefs.filter((p) => p.kind === kind).map((p) => String(p.value)).filter(Boolean);

  const lines: string[] = [];
  const important = byKind('important_sender');
  const ignored = byKind('ignored_sender');
  const liked = byKind('liked_newsletter');
  const topics = byKind('important_topic');
  const timeSensitive = byKind('time_sensitive_category');

  if (important.length)
    lines.push(`- ALWAYS surface mail from these senders/domains and rank it higher: ${important.join(', ')}.`);
  if (ignored.length)
    lines.push(`- NEVER surface mail from these senders/domains — do not create a decision for them: ${ignored.join(', ')}.`);
  if (topics.length)
    lines.push(`- The user cares about these topics; weight related mail up: ${topics.join(', ')}.`);
  if (timeSensitive.length)
    lines.push(`- Treat these categories as time-sensitive (raise urgency): ${timeSensitive.join(', ')}.`);
  if (liked.length)
    lines.push(`- The user values these newsletters; you MAY surface them only if genuinely actionable: ${liked.join(', ')}.`);

  if (!lines.length) return '';
  return `\n\nUSER PREFERENCES (these are standing instructions — honour them strictly):\n${lines.join('\n')}`;
}

// ── payload builders ──

function slimForClutter(batch: EmailCandidate[]): string {
  return JSON.stringify(
    batch.map((c) => ({
      id: c.id,
      threadId: c.threadId,
      from: c.from,
      subject: c.subject,
      snippet: c.snippet.slice(0, 240),
      receivedAt: c.receivedAt ?? null,
      hasUnsubscribeLink: c.hasUnsubscribeLink,
    }))
  );
}

function slimForDecisions(batch: EmailCandidate[], friendlyName: (id: string) => string): string {
  return JSON.stringify(
    batch.map((c) => ({
      id: c.id,
      from: friendlyName(c.id),
      domain: domainOf(c.from.email),
      subject: c.subject.slice(0, 200),
      snippet: c.snippet.slice(0, 240),
      receivedAt: c.receivedAt ?? null,
      hasUnsubscribeLink: c.hasUnsubscribeLink,
    }))
  );
}

/**
 * Build the temporal frame prepended to BOTH the clutter and decision run()
 * inputs. Anchors the model to the real "now" so every relative date in an email
 * ('tomorrow', 'next Tue', 'the 15th') is resolved against that email's
 * receivedAt — not against the model's training cutoff. Defensive: a bad `now`
 * never throws.
 */
function temporalFrame(now: Date): string {
  let iso = '';
  let weekday = '';
  try {
    iso = now.toISOString().slice(0, 10);
    weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  } catch {
    /* leave blank — frame still degrades gracefully */
  }
  return `TODAY IS ${iso} (${weekday}). Resolve every relative date ('tomorrow', 'next Tue', 'the 15th') against each email's receivedAt, not against your training data.\n`;
}

// ── hydration / validation (server is authoritative for display fields) ──

function hydrateClutter(f: ClutterFinding, byId: Map<string, EmailCandidate>): ClutterFinding | null {
  const c = byId.get(f.emailId);
  if (!c) return null;
  const parsed = ClutterFindingSchema.safeParse({
    ...f,
    senderDomain: domainOf(c.from.email) || c.from.email.toLowerCase(),
    senderDisplay: resolveSenderName(c.from, domainOf(c.from.email)),
    hasUnsubscribeLink: c.hasUnsubscribeLink,
    reversible: f.suggestedAction !== 'unsubscribe',
  });
  return parsed.success ? parsed.data : null;
}

const URGENCY_RANK: Record<string, number> = { critical: 3, high: 2, normal: 1, low: 0 };

// ── Temporal ranking / demotion tunables ──
/** Older than this (days), an undated standing/none item is "likely handled". */
const STALE_AGE_DAYS = 21;
/** A due date within this many days gets a ranking boost (and scaled by nearness). */
const DUE_SOON_DAYS = 7;
/**
 * Overdue grace window (days). A deadline that just passed is MORE urgent; the
 * overdue boost decays smoothly and crosses ZERO at roughly this many days past
 * due, then goes negative — so a months-old "overdue" with no recent email sinks
 * below live items instead of floating to the top. This is the single concept
 * shared by the overdue score curve AND the long-past-deadline demotion (a
 * continuous decay, not a hand-tuned cliff per branch). */
const OVERDUE_GRACE_DAYS = 30;
/** Peak ranking boost for a just-/recently-overdue obligation (at 0 days past due). */
const OVERDUE_PEAK_BOOST = 1.2;
/** Max DEMOTED ("likely past — handled?") decisions we keep, on top of the active cap. */
const MAX_DEMOTED = 6;
/** Milliseconds in a day. */
const DAY = 86400000;

/**
 * Parse an ISO string to epoch ms. Returns null on anything unparseable (NaN,
 * empty, non-string) so callers can treat the time as UNKNOWN — never throws.
 * DOM-scraped dates are unreliable, so an unknown date must always be safe.
 */
function epochMs(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Bare category words a title must never collapse to — these are themes/synonyms,
 * not the verb-led decision titles the contract requires.
 */
const DEGENERATE_TITLES = new Set([
  'money', 'reply', 'replies', 'schedule', 'scheduling', 'job', 'career', 'travel',
  'admin', 'security', 'other', 'fyi', 'payment', 'payments', 'bill', 'bills',
  'invoice', 'invoices', 'email', 'emails', 'inbox', 'todo', 'todos',
]);

function hydrateDecisions(
  drafts: DecisionOut[],
  byId: Map<string, EmailCandidate>,
  friendlyName: (id: string) => string,
  now: Date
): Decision[] {
  // Anchor the current time once as epoch ms. Guard against an invalid Date so a
  // temporal computation can never throw and break the decisions flow.
  const nowMs = (() => {
    const t = now.getTime();
    return Number.isNaN(t) ? Date.now() : t;
  })();

  const out: Decision[] = [];
  // Temporal ranking score per decision id, used only for the sort below.
  const scoreById = new Map<string, number>();
  for (const d of drafts) {
    // Guard against degenerate titles. A Decision title is contracted to be
    // verb-led and in the user's voice ("Pay Absa R1,240 by Friday"); when the
    // model instead echoes the bare category ("money", "reply"), that leaks
    // into the Today list as a meaningless card heading — drop it.
    const titleNorm = d.title.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!titleNorm || DEGENERATE_TITLES.has(titleNorm)) continue;
    const emailIds = d.emailIds.filter((id) => byId.has(id));
    const senders =
      d.senders.filter((s) => s && !s.includes('@')).length > 0
        ? d.senders.filter((s) => s && !s.includes('@'))
        : emailIds.map(friendlyName);
    const first = emailIds[0] ? byId.get(emailIds[0]) : undefined;

    // ── Recency: the MOST RECENT received date among folded candidates ──
    // Missing dates are treated as unknown (skipped from the max), and an item
    // with NO known date is treated as fresh (ageDays 0) — never demoted, since
    // DOM scraping is unreliable and hiding a live item is the worse failure.
    let receivedMs: number | null = null;
    for (const id of emailIds) {
      const ms = epochMs(byId.get(id)?.receivedAt);
      if (ms !== null && (receivedMs === null || ms > receivedMs)) receivedMs = ms;
    }
    const receivedAt = receivedMs !== null ? new Date(receivedMs).toISOString() : null;
    const ageDays = receivedMs !== null ? (nowMs - receivedMs) / DAY : 0;

    const dueMs = epochMs(d.dueAt);
    const daysToDue = dueMs !== null ? (dueMs - nowMs) / DAY : null;

    const windowType = d.windowType;
    const resolved = d.resolved === true;
    const urgency = d.urgency;
    const theme = d.theme;

    // ── Demotion (FIRST match wins) ── never DELETE, only sink one tap away ──
    let demoted = false;
    let demotedReason: string | null = null;
    if (resolved) {
      demoted = true;
      demotedReason = 'looks already handled';
    } else if (windowType === 'event' && daysToDue !== null && daysToDue < 0) {
      // A moment that already passed is dead.
      demoted = true;
      demotedReason = `this was scheduled for ${Math.round(-daysToDue)} day(s) ago`;
    } else if (
      // LONG-PAST DEADLINE: a deadline whose dueAt is well past the grace window
      // AND whose newest email is itself stale (no recent follow-up) is almost
      // always an already-charged receipt the model mis-read as an obligation
      // (the 8-month-old Uber receipt). Sink it with a hedged reason. A genuine
      // unpaid bill that's only days overdue stays LIVE (within the grace window),
      // and one with a RECENT chase email stays live (ageDays small). A still
      // critically-urgent item is never auto-demoted. Money is NOT exempt here —
      // a stale receipt with an invented due date must be demotable (#32).
      windowType === 'deadline' &&
      daysToDue !== null &&
      daysToDue < -OVERDUE_GRACE_DAYS &&
      ageDays > STALE_AGE_DAYS &&
      urgency !== 'critical' &&
      theme !== 'security'
    ) {
      demoted = true;
      demotedReason = `was due about ${Math.round(-daysToDue / 7)} week(s) ago — likely already handled`;
    } else if (
      // STALE: an undated, non-time-critical standing/none item that's gone quiet.
      // EXEMPT: security, any real future due date, deadlines, and critical/high
      // urgency — those grow MORE urgent (or stay live) with age. Money is no
      // longer blanket-exempt (#32): an undated, old, low-urgency money item has
      // no open obligation signal (no due date, no recent activity), so it may
      // sink too — a live bill always carries a due date or recent/elevated
      // urgency and so never reaches this branch.
      !d.dueAt &&
      (windowType === 'standing' || windowType === 'none') &&
      ageDays > STALE_AGE_DAYS &&
      (urgency === 'normal' || urgency === 'low') &&
      theme !== 'security'
    ) {
      demoted = true;
      demotedReason = `from about ${Math.round(ageDays / 7)} week(s) ago — likely already handled`;
    }
    // Missing receivedAt => ageDays 0 => stale branch never fires => never demoted.
    // The future-due / deadline / urgency exemptions are expressed by the stale
    // branch's own guards (!d.dueAt, windowType, urgency) above.

    // ── Ranking score (sort DESC) — urgency stays primary; time only reorders ──
    let score = URGENCY_RANK[urgency] ?? 0;
    // due-soon boost: nearer deadlines rank higher, scaled 0..1.5.
    if (daysToDue !== null && daysToDue >= 0 && daysToDue <= DUE_SOON_DAYS) {
      score += 1.5 * (1 - daysToDue / DUE_SOON_DAYS);
    }
    // overdue-deadline curve: a freshly-overdue obligation is MORE urgent (peak
    // boost), but the boost decays continuously, crosses ZERO around the grace
    // window, and goes NEGATIVE as the gap widens — so a months-past "overdue"
    // ranks BELOW live items instead of getting a flat promotion to the top.
    // No hard cutoff: a straight line through f(0)=+PEAK, f(GRACE)=0 (#32).
    if (windowType === 'deadline' && daysToDue !== null && daysToDue < 0) {
      const overdueDays = -daysToDue;
      score += OVERDUE_PEAK_BOOST * (1 - overdueDays / OVERDUE_GRACE_DAYS);
    }
    score += (d.confidence ?? 0.7) * 0.1;
    // gentle, continuous recency tiebreaker (no cliff): older items drift down.
    score -= ageDays / 365;

    const parsed = DecisionSchema.safeParse({
      id: nanoid(),
      title: d.title.slice(0, 140),
      why: (d.why || 'Surfaced from your inbox.').slice(0, 400),
      theme: d.theme,
      urgency: d.urgency,
      emailIds,
      senders: Array.from(new Set(senders)).slice(0, 6),
      count: Math.max(1, emailIds.length),
      dueAt: d.dueAt ?? null,
      suggestedAction: d.action ?? null,
      confidence: Math.max(0, Math.min(1, d.confidence ?? 0.7)),
      rowSelector: first?.domAnchor.rowSelector ?? null,
      actionUrl: first?.actionUrl ?? null,
      threadLocator: first?.threadLocator ?? null,
      windowType,
      resolved,
      receivedAt,
      demoted,
      demotedReason,
    });
    if (parsed.success && parsed.data.title.trim()) {
      out.push(parsed.data);
      scoreById.set(parsed.data.id, score);
    }
  }

  const ranked = out
    .filter((d) => d.confidence >= 0.45)
    .sort((a, b) => {
      // Demoted items ALWAYS come after non-demoted ones.
      if (a.demoted !== b.demoted) return a.demoted ? 1 : -1;
      // Within each group: by temporal score DESC, then confidence as a tiebreak.
      const sb = scoreById.get(b.id) ?? 0;
      const sa = scoreById.get(a.id) ?? 0;
      return sb - sa || b.confidence - a.confidence;
    });

  // Cap: up to MAX_DECISIONS ACTIVE plus up to MAX_DEMOTED demoted; active first.
  const active = ranked.filter((d) => !d.demoted).slice(0, MAX_DECISIONS);
  const demotedList = ranked.filter((d) => d.demoted).slice(0, MAX_DEMOTED);
  return [...active, ...demotedList];
}

// ---- Chat ----

interface ChatInput {
  turnId: string;
  message: string;
  context?: {
    recentClutter?: ClutterFinding[];
    recentDecisions?: Decision[];
  };
  writer: SseWriter;
  /** Overridable config forwarded from the extension Settings (see ClassifyInput). */
  settings?: ClientSettings;
}

export async function runAgentChat(input: ChatInput): Promise<string> {
  const cfg = resolveConfig(input.settings);
  ensureKey(input.settings);
  await ensureServerWeave(cfg.wandbApiKey, cfg.wandbProject).catch(() => {});
  const sessionId = nanoid();
  const { turnId, message, context, writer } = input;

  await emit(writer, sessionId, turnId, { kind: 'session_start', message: `chat: ${message.slice(0, 80)}` });

  const orchestrator = new Agent({
    name: AGENT_NAMES.orchestrator,
    instructions:
      INSTRUCTIONS[AGENT_NAMES.orchestrator] +
      "\n\nYou are answering a chat message about the user's inbox. Be concise. If you don't know, say so. " +
      'Never propose to delete or send mail.',
    model: cfg.model,
  });

  const ctxBlob = context
    ? `\n\n(Recent inbox context: ${JSON.stringify({
        clutter: (context.recentClutter ?? []).slice(0, 20),
        decisions: (context.recentDecisions ?? []).slice(0, 20),
      })})`
    : '';

  await emit(writer, sessionId, turnId, { kind: 'agent_start', agent: AGENT_NAMES.orchestrator });
  const result = await traced('email_signal.chat', { message: message.slice(0, 200) },
    () => run(orchestrator, `${message}${ctxBlob}`));
  const text = String(result.finalOutput ?? '');
  await emit(writer, sessionId, turnId, { kind: 'agent_end', agent: AGENT_NAMES.orchestrator, message: `reply length ${text.length}` });
  await emit(writer, sessionId, turnId, { kind: 'session_end' });
  return text;
}
