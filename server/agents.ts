import { Agent, run, setDefaultOpenAIKey } from '@openai/agents';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  ClutterFindingSchema,
  EmailCandidate,
  ClutterFinding,
  PriorityFindingSchema,
  PriorityFinding,
} from '../src/schemas/index.js';
import { AGENT_NAMES, INSTRUCTIONS } from '../src/agents/agent-defs.js';
import { emit, SseWriter } from './trace-bridge.js';

const MODEL = process.env['EMAIL_SIGNAL_MODEL'] ?? 'gpt-4.1-mini';

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

/**
 * Pull every available detail out of a thrown SDK error. The agents SDK's
 * ModelBehaviorError stuffs the underlying Zod issue into `cause` / `data` /
 * the current span — the bare `.message` is just "Invalid output type",
 * which doesn't help debug schema drift.
 */
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

function ensureKey(): void {
  const key = process.env['OPENAI_API_KEY'];
  if (!key) {
    throw new Error('OPENAI_API_KEY is not set on the server. Add it to server/.env or the process env.');
  }
  setDefaultOpenAIKey(key);
}

// ---- Shared schemas ----
const ClutterBatchSchema = z.object({ findings: z.array(ClutterFindingSchema) });
const PriorityBatchSchema = z.object({ findings: z.array(PriorityFindingSchema) });

interface ClassifyInput {
  turnId: string;
  candidates: EmailCandidate[];
  writer: SseWriter;
}

interface ClassifyOutput {
  clutter: ClutterFinding[];
  priorities: PriorityFinding[];
}

export async function runAgentClassification(input: ClassifyInput): Promise<ClassifyOutput> {
  ensureKey();
  const sessionId = nanoid();
  const { turnId, candidates, writer } = input;

  await emit(writer, sessionId, turnId, {
    kind: 'session_start',
    message: `Classifying ${candidates.length} candidates`,
  });

  const clutterAgent = new Agent({
    name: AGENT_NAMES.clutter,
    instructions: INSTRUCTIONS[AGENT_NAMES.clutter],
    model: MODEL,
    outputType: ClutterBatchSchema,
  });

  const priorityAgent = new Agent({
    name: AGENT_NAMES.priority,
    instructions: INSTRUCTIONS[AGENT_NAMES.priority],
    model: MODEL,
    outputType: PriorityBatchSchema,
  });

  // Compact serialization keeps the prompt cheap.
  const payload = JSON.stringify(
    candidates.map((c) => ({
      id: c.id,
      threadId: c.threadId,
      from: c.from,
      subject: c.subject,
      snippet: c.snippet,
      hasUnsubscribeLink: c.hasUnsubscribeLink,
    }))
  );

  await emit(writer, sessionId, turnId, {
    kind: 'agent_start',
    agent: AGENT_NAMES.clutter,
    message: 'classifying clutter',
  });
  await emit(writer, sessionId, turnId, {
    kind: 'agent_start',
    agent: AGENT_NAMES.priority,
    message: 'identifying priorities',
  });

  // Run the two classification agents sequentially. Parallel runs hit a
  // race in the SDK's AsyncLocalStorage trace-context propagation
  // (multiple top-level `run()` calls scheduled together cause
  // "No existing trace found" inside the SDK). Sequential keeps each
  // run inside its own clean `getOrCreateTrace` scope.
  const clutterResult = await runSafe(() =>
    run(
      clutterAgent,
      `Classify these EmailCandidates and return {findings: ClutterFinding[]} only.\n${payload}`
    )
  );
  const priorityResult = await runSafe(() =>
    run(
      priorityAgent,
      `Identify priority emails from these candidates and return {findings: PriorityFinding[]} only.\n${payload}`
    )
  );

  let clutter: ClutterFinding[] = [];
  let priorities: PriorityFinding[] = [];

  if (clutterResult.status === 'fulfilled') {
    const out = clutterResult.value.finalOutput as { findings?: ClutterFinding[] } | undefined;
    clutter = out?.findings ?? [];
    await emit(writer, sessionId, turnId, {
      kind: 'agent_end',
      agent: AGENT_NAMES.clutter,
      message: `clutter findings: ${clutter.length}`,
    });
  } else {
    const detail = formatRunError(clutterResult.reason);
    console.error('[emailsignal-server] clutter agent failed:', detail);
    await emit(writer, sessionId, turnId, {
      kind: 'error',
      agent: AGENT_NAMES.clutter,
      message: detail,
    });
  }

  if (priorityResult.status === 'fulfilled') {
    const out = priorityResult.value.finalOutput as { findings?: PriorityFinding[] } | undefined;
    priorities = out?.findings ?? [];
    await emit(writer, sessionId, turnId, {
      kind: 'agent_end',
      agent: AGENT_NAMES.priority,
      message: `priority findings: ${priorities.length}`,
    });
  } else {
    const detail = formatRunError(priorityResult.reason);
    console.error('[emailsignal-server] priority agent failed:', detail);
    await emit(writer, sessionId, turnId, {
      kind: 'error',
      agent: AGENT_NAMES.priority,
      message: detail,
    });
  }

  await emit(writer, sessionId, turnId, { kind: 'session_end' });
  return { clutter, priorities };
}

interface ChatInput {
  turnId: string;
  message: string;
  context?: {
    recentClutter?: ClutterFinding[];
    recentPriorities?: PriorityFinding[];
  };
  writer: SseWriter;
}

export async function runAgentChat(input: ChatInput): Promise<string> {
  ensureKey();
  const sessionId = nanoid();
  const { turnId, message, context, writer } = input;

  await emit(writer, sessionId, turnId, {
    kind: 'session_start',
    message: `chat: ${message.slice(0, 80)}`,
  });

  const orchestrator = new Agent({
    name: AGENT_NAMES.orchestrator,
    instructions:
      INSTRUCTIONS[AGENT_NAMES.orchestrator] +
      "\n\nYou are answering a chat message. Be concise. If you don't know, say so. " +
      "Never propose to delete or send mail.",
    model: MODEL,
  });

  const ctxBlob = context
    ? `\n\n(Recent inbox context: ${JSON.stringify({
        clutter: (context.recentClutter ?? []).slice(0, 20),
        priorities: (context.recentPriorities ?? []).slice(0, 20),
      })})`
    : '';

  await emit(writer, sessionId, turnId, {
    kind: 'agent_start',
    agent: AGENT_NAMES.orchestrator,
  });
  const result = await run(orchestrator, `${message}${ctxBlob}`);
  const text = String(result.finalOutput ?? '');
  await emit(writer, sessionId, turnId, {
    kind: 'agent_end',
    agent: AGENT_NAMES.orchestrator,
    message: `reply length ${text.length}`,
  });
  await emit(writer, sessionId, turnId, { kind: 'session_end' });
  return text;
}
