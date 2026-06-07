import { Agent, run, setDefaultOpenAIKey } from '@openai/agents';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  ClutterFindingSchema,
  EmailCandidate,
  ClutterFinding,
  Decision,
  DecisionSchema,
} from '../src/schemas/index.js';
import { AGENT_NAMES, INSTRUCTIONS } from '../src/agents/agent-defs.js';
import { resolveSenderName, domainOf } from '../src/common/sender.js';
import { emit, SseWriter } from './trace-bridge.js';

const MODEL = process.env['EMAIL_SIGNAL_MODEL'] ?? 'gpt-4.1-mini';

/** Max candidates per parallel classifier call. */
const BATCH_SIZE = Number(process.env['EMAIL_SIGNAL_BATCH_SIZE'] ?? 25);
/** Max decisions we ever return — the whole point is a short list. */
const MAX_DECISIONS = 8;

let weaveReady = false;

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
  if (weaveReady) return;
  if (!process.env['WANDB_API_KEY']) return; // tracing disabled silently
  try {
    const weave = await import('weave');
    const project = process.env['WANDB_PROJECT'] ?? 'email-signal';
    await (weave as any).init(project);
    weaveReady = true;
    // eslint-disable-next-line no-console
    console.log(`[emailsignal-server] Weave initialized for project "${project}"`);
  } catch (err) {
    console.warn('[emailsignal-server] weave init failed', err);
  }
}

/**
 * Resolve the OpenAI key for this run. The extension forwards the key the user
 * pasted in Settings; we fall back to the server's own env. The key is only ever
 * used here, with the `@openai/agents` SDK — never sent anywhere else.
 */
function ensureKey(override?: string): void {
  const key = override?.trim() || process.env['OPENAI_API_KEY'];
  if (!key) {
    throw new Error(
      'No OpenAI API key. Add one in the extension Settings (it is sent to this sidecar) or in server/.env.'
    );
  }
  setDefaultOpenAIKey(key);
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
});
const DecisionBatchSchema = z.object({ decisions: z.array(DecisionOutSchema) });
type DecisionOut = z.infer<typeof DecisionOutSchema>;

interface ClassifyInput {
  turnId: string;
  candidates: EmailCandidate[];
  writer: SseWriter;
  /** Key forwarded from the extension Settings; overrides server env if set. */
  apiKey?: string;
}

export interface ClassifyOutput {
  clutter: ClutterFinding[];
  decisions: Decision[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length === 0 ? [[]] : out;
}

function buildClutterAgent(): Agent<unknown, typeof ClutterBatchSchema> {
  return new Agent({
    name: AGENT_NAMES.clutter,
    instructions: INSTRUCTIONS[AGENT_NAMES.clutter],
    model: MODEL,
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

HARD RULES (these are the exact mistakes to avoid):
  - A bank/account/insurance STATEMENT is NOT a payment reminder unless there is a real amount due AND an action to pay by a date. Otherwise theme=admin, low urgency — or omit it.
  - Marketing/cold/bulk mail that opens "Hi {name/city}" does NOT need a reply.
  - Newsletters, promotions, notifications, social updates are NEVER decisions — omit them entirely.
  - Prefer FEW, high-confidence decisions. If nothing genuinely needs the user, return an empty list. NEVER pad.`;

function buildDecisionAgent(): Agent<unknown, typeof DecisionBatchSchema> {
  return new Agent({
    name: 'DecisionSynthesizerAgent',
    instructions: DECISION_INSTRUCTIONS,
    model: MODEL,
    outputType: DecisionBatchSchema,
  });
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
  ensureKey(input.apiKey);
  const sessionId = nanoid();
  const { turnId, candidates, writer } = input;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const friendlyName = (id: string): string => {
    const c = byId.get(id);
    return c ? resolveSenderName(c.from, domainOf(c.from.email)) : 'Unknown sender';
  };

  await emit(writer, sessionId, turnId, {
    kind: 'session_start',
    message: `Classifying ${candidates.length} candidates`,
  });

  const clutterAgent = buildClutterAgent();
  const decisionAgent = buildDecisionAgent();

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
      run(clutterAgent, `Classify these EmailCandidates and return {findings: ClutterFinding[]} only.\n${slimForClutter(batch)}`)
        .catch((reason) => {
          void emit(writer, sessionId, turnId, { kind: 'error', agent: AGENT_NAMES.clutter, message: `clutter batch ${idx + 1}: ${formatRunError(reason)}` });
          throw reason;
        })
    )
  );

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
        run(decisionAgent, `Synthesize decisions from these emails. Return {decisions: Decision[]} only.\n${slimForDecisions(batch, friendlyName)}`)
          .catch((reason) => {
            void emit(writer, sessionId, turnId, { kind: 'error', agent: 'DecisionSynthesizerAgent', message: `synthesis batch ${idx + 1}: ${formatRunError(reason)}` });
            throw reason;
          })
      )
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        drafts.push(...((r.value.finalOutput as { decisions?: DecisionOut[] } | undefined)?.decisions ?? []));
      }
    }

    // Cross-batch consolidation when we have more than a short list.
    if (drafts.length > MAX_DECISIONS) {
      const cons = await runSafe(() =>
        run(decisionAgent, `These draft decisions came from different batches of ONE inbox. Merge duplicates/related ones (same sender + same ask), keep the union of emailIds, and return the TOP ${MAX_DECISIONS} as {decisions: Decision[]}. Drop weak ones rather than padding.\n${JSON.stringify(drafts)}`)
      );
      if (cons.status === 'fulfilled') {
        const merged = (cons.value.finalOutput as { decisions?: DecisionOut[] } | undefined)?.decisions;
        if (merged && merged.length) drafts = merged;
      }
    }
  }

  const decisions = hydrateDecisions(drafts, byId, friendlyName);
  await emit(writer, sessionId, turnId, { kind: 'agent_end', agent: 'DecisionSynthesizerAgent', message: `decisions: ${decisions.length}` });
  await emit(writer, sessionId, turnId, { kind: 'session_end' });
  return { clutter, decisions };
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
      hasUnsubscribeLink: c.hasUnsubscribeLink,
    }))
  );
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
  friendlyName: (id: string) => string
): Decision[] {
  const out: Decision[] = [];
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
    });
    if (parsed.success && parsed.data.title.trim()) out.push(parsed.data);
  }
  return out
    .filter((d) => d.confidence >= 0.45)
    .sort((a, b) => (URGENCY_RANK[b.urgency]! - URGENCY_RANK[a.urgency]!) || b.confidence - a.confidence)
    .slice(0, MAX_DECISIONS);
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
  apiKey?: string;
}

export async function runAgentChat(input: ChatInput): Promise<string> {
  ensureKey(input.apiKey);
  const sessionId = nanoid();
  const { turnId, message, context, writer } = input;

  await emit(writer, sessionId, turnId, { kind: 'session_start', message: `chat: ${message.slice(0, 80)}` });

  const orchestrator = new Agent({
    name: AGENT_NAMES.orchestrator,
    instructions:
      INSTRUCTIONS[AGENT_NAMES.orchestrator] +
      "\n\nYou are answering a chat message about the user's inbox. Be concise. If you don't know, say so. " +
      'Never propose to delete or send mail.',
    model: MODEL,
  });

  const ctxBlob = context
    ? `\n\n(Recent inbox context: ${JSON.stringify({
        clutter: (context.recentClutter ?? []).slice(0, 20),
        decisions: (context.recentDecisions ?? []).slice(0, 20),
      })})`
    : '';

  await emit(writer, sessionId, turnId, { kind: 'agent_start', agent: AGENT_NAMES.orchestrator });
  const result = await run(orchestrator, `${message}${ctxBlob}`);
  const text = String(result.finalOutput ?? '');
  await emit(writer, sessionId, turnId, { kind: 'agent_end', agent: AGENT_NAMES.orchestrator, message: `reply length ${text.length}` });
  await emit(writer, sessionId, turnId, { kind: 'session_end' });
  return text;
}
