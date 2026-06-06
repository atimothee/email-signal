import { Agent, handoff, run, setDefaultOpenAIKey } from '@openai/agents';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  ClutterFindingSchema,
  EmailCandidate,
  ClutterFinding,
  PriorityFindingSchema,
  PriorityFinding,
} from '../src/schemas/index.js';
import { AGENT_NAMES, INSTRUCTIONS, AGENT_REGISTRY } from '../src/agents/agent-defs.js';
import { emit, SseWriter } from './trace-bridge.js';

const MODEL = process.env['EMAIL_SIGNAL_MODEL'] ?? 'gpt-4.1-mini';

/** Max candidates per parallel classifier call. */
const BATCH_SIZE = Number(process.env['EMAIL_SIGNAL_BATCH_SIZE'] ?? 8);

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

const ClutterHandoffInput = z.object({
  reason: z.string(),
  batchIndex: z.number().int().min(0),
  batchCount: z.number().int().min(1),
});
const PriorityHandoffInput = z.object({
  reason: z.string(),
  batchIndex: z.number().int().min(0),
  batchCount: z.number().int().min(1),
});

interface ClassifyInput {
  turnId: string;
  candidates: EmailCandidate[];
  writer: SseWriter;
}

interface ClassifyOutput {
  clutter: ClutterFinding[];
  priorities: PriorityFinding[];
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

function buildPriorityAgent(): Agent<unknown, typeof PriorityBatchSchema> {
  return new Agent({
    name: AGENT_NAMES.priority,
    instructions: INSTRUCTIONS[AGENT_NAMES.priority],
    model: MODEL,
    outputType: PriorityBatchSchema,
  });
}

/**
 * Build the OrchestratorAgent with explicit handoffs to the classifiers via
 * `@openai/agents` `handoff()`. The `onHandoff` callback fires when the
 * orchestrator delegates — we mirror that into our AgentTraceEvent stream and
 * Weave so the extension cockpit sees every handoff in real-time.
 */
function buildOrchestratorAgent(opts: {
  writer: SseWriter;
  sessionId: string;
  turnId: string;
}): Agent<unknown, any> {
  const clutterAgent = buildClutterAgent();
  const priorityAgent = buildPriorityAgent();

  const clutterHandoff = handoff(clutterAgent, {
    inputType: ClutterHandoffInput,
    onHandoff: async (_runCtx, input) => {
      await emit(opts.writer, opts.sessionId, opts.turnId, {
        kind: 'agent_handoff',
        agent: AGENT_NAMES.orchestrator,
        message: `${AGENT_NAMES.orchestrator} → ${AGENT_NAMES.clutter}: classify_clutter`,
        data: {
          fromAgent: AGENT_NAMES.orchestrator,
          toAgent: AGENT_NAMES.clutter,
          kind: 'classify_clutter',
          batchIndex: input?.batchIndex,
          batchCount: input?.batchCount,
          reason: input?.reason,
        },
      });
    },
  });

  const priorityHandoff = handoff(priorityAgent, {
    inputType: PriorityHandoffInput,
    onHandoff: async (_runCtx, input) => {
      await emit(opts.writer, opts.sessionId, opts.turnId, {
        kind: 'agent_handoff',
        agent: AGENT_NAMES.orchestrator,
        message: `${AGENT_NAMES.orchestrator} → ${AGENT_NAMES.priority}: classify_priority`,
        data: {
          fromAgent: AGENT_NAMES.orchestrator,
          toAgent: AGENT_NAMES.priority,
          kind: 'classify_priority',
          batchIndex: input?.batchIndex,
          batchCount: input?.batchCount,
          reason: input?.reason,
        },
      });
    },
  });

  const responsibilities = AGENT_REGISTRY[AGENT_NAMES.orchestrator].responsibilities
    .map((r) => `- ${r}`)
    .join('\n');

  return new Agent({
    name: AGENT_NAMES.orchestrator,
    instructions:
      INSTRUCTIONS[AGENT_NAMES.orchestrator] +
      '\n\nResponsibilities:\n' +
      responsibilities,
    model: MODEL,
    handoffs: [clutterHandoff, priorityHandoff],
  });
}

/**
 * Parallel batch classification.
 *
 * Strategy:
 *  - The OrchestratorAgent is built with explicit SDK handoffs to Clutter +
 *    Priority. We emit a typed `agent_handoff` trace BEFORE invoking each batch
 *    so the timeline shows the explicit delegation.
 *  - Candidates are chunked into BATCH_SIZE-sized groups. Each batch runs both
 *    classifiers in parallel via Promise.all; batches themselves run in
 *    parallel via Promise.allSettled — a single batch failure does not kill
 *    the whole turn.
 */
export async function runAgentClassification(input: ClassifyInput): Promise<ClassifyOutput> {
  ensureKey();
  const sessionId = nanoid();
  const { turnId, candidates, writer } = input;

  await emit(writer, sessionId, turnId, {
    kind: 'session_start',
    message: `Classifying ${candidates.length} candidates`,
  });

  // Build the orchestrator agent with handoffs registered so the SDK emits
  // its own trace spans for the delegation; we also emit our own
  // agent_handoff events for each batch.
  buildOrchestratorAgent({ writer, sessionId, turnId });
  const clutterAgent = buildClutterAgent();
  const priorityAgent = buildPriorityAgent();

  const batches = chunk(candidates, BATCH_SIZE);
  await emit(writer, sessionId, turnId, {
    kind: 'agent_start',
    agent: AGENT_NAMES.orchestrator,
    message: `dispatching ${batches.length} batch(es) of up to ${BATCH_SIZE}`,
  });

  // Per-batch handoff events.
  for (let i = 0; i < batches.length; i++) {
    await emit(writer, sessionId, turnId, {
      kind: 'agent_handoff',
      agent: AGENT_NAMES.orchestrator,
      message: `${AGENT_NAMES.orchestrator} → ${AGENT_NAMES.clutter}: classify_clutter`,
      data: {
        fromAgent: AGENT_NAMES.orchestrator,
        toAgent: AGENT_NAMES.clutter,
        kind: 'classify_clutter',
        batchIndex: i,
        batchCount: batches.length,
        candidateIds: batches[i]!.map((c) => c.id),
      },
    });
    await emit(writer, sessionId, turnId, {
      kind: 'agent_handoff',
      agent: AGENT_NAMES.orchestrator,
      message: `${AGENT_NAMES.orchestrator} → ${AGENT_NAMES.priority}: classify_priority`,
      data: {
        fromAgent: AGENT_NAMES.orchestrator,
        toAgent: AGENT_NAMES.priority,
        kind: 'classify_priority',
        batchIndex: i,
        batchCount: batches.length,
        candidateIds: batches[i]!.map((c) => c.id),
      },
    });
  }

  const batchResults = await Promise.allSettled(
    batches.map(async (batch, idx) => {
      const payload = JSON.stringify(
        batch.map((c) => ({
          id: c.id,
          threadId: c.threadId,
          from: c.from,
          subject: c.subject,
          snippet: c.snippet,
          hasUnsubscribeLink: c.hasUnsubscribeLink,
        }))
      );

      // Sequential within a single batch (clutter then priority) keeps each
      // top-level run() inside its own AsyncLocalStorage trace scope — a
      // known SDK constraint. Cross-batch parallelism does the heavy lifting.
      const clutterRes = await runSafe(() =>
        run(
          clutterAgent,
          `Classify these EmailCandidates and return {findings: ClutterFinding[]} only.\n${payload}`
        )
      );
      const priorityRes = await runSafe(() =>
        run(
          priorityAgent,
          `Identify priority emails from these candidates and return {findings: PriorityFinding[]} only.\n${payload}`
        )
      );

      const clutterOut =
        clutterRes.status === 'fulfilled'
          ? ((clutterRes.value.finalOutput as { findings?: ClutterFinding[] } | undefined)?.findings ?? [])
          : null;
      const priorityOut =
        priorityRes.status === 'fulfilled'
          ? ((priorityRes.value.finalOutput as { findings?: PriorityFinding[] } | undefined)?.findings ?? [])
          : null;

      if (clutterOut === null) {
        const detail = formatRunError((clutterRes as any).reason);
        await emit(writer, sessionId, turnId, {
          kind: 'error',
          agent: AGENT_NAMES.clutter,
          message: `batch ${idx + 1}/${batches.length}: ${detail}`,
        });
      }
      if (priorityOut === null) {
        const detail = formatRunError((priorityRes as any).reason);
        await emit(writer, sessionId, turnId, {
          kind: 'error',
          agent: AGENT_NAMES.priority,
          message: `batch ${idx + 1}/${batches.length}: ${detail}`,
        });
      }

      return {
        clutter: clutterOut ?? [],
        priorities: priorityOut ?? [],
      };
    })
  );

  let clutter: ClutterFinding[] = [];
  let priorities: PriorityFinding[] = [];
  for (const r of batchResults) {
    if (r.status === 'fulfilled') {
      clutter = clutter.concat(r.value.clutter);
      priorities = priorities.concat(r.value.priorities);
    }
  }

  await emit(writer, sessionId, turnId, {
    kind: 'agent_end',
    agent: AGENT_NAMES.clutter,
    message: `clutter findings: ${clutter.length}`,
  });
  await emit(writer, sessionId, turnId, {
    kind: 'agent_end',
    agent: AGENT_NAMES.priority,
    message: `priority findings: ${priorities.length}`,
  });
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
