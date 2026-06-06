import {
  ActionItem,
  ActionItemSchema,
  ClutterFinding,
  ClutterFindingSchema,
  EmailCandidate,
  PriorityFinding,
  PriorityFindingSchema,
  AgentTraceEventSchema,
} from '@schemas/index';
import { AGENT_NAMES } from './agent-defs';
import { recordTrace } from '@/weave/tracing';
import { sseFetch, isServerHealthy } from '@/common/server-client';
import { synthesizeActionItemsLocal, sortActionItems } from './synthesis';

interface OrchestratorRunInput {
  turnId: string;
  candidates?: EmailCandidate[];
  userMessage?: string;
  context?: {
    recentClutter?: ClutterFinding[];
    recentPriorities?: PriorityFinding[];
  };
}

interface OrchestratorRunOutput {
  clutter: ClutterFinding[];
  priorities: PriorityFinding[];
  text?: string;
}

interface SynthesisRunInput {
  turnId: string;
  priorities: PriorityFinding[];
  clutter: ClutterFinding[];
  candidates: EmailCandidate[];
}

/**
 * The extension never runs `@openai/agents` directly — Chrome service
 * workers can't load Node-only SDKs. Instead, we stream agent execution
 * from the local sidecar at http://localhost:3030 (configurable in Settings).
 *
 * The server pushes back:
 *  - `trace`         events → mirrored into recordTrace() so the cockpit
 *                              fills in real-time
 *  - `classification` events → drained into clutter/priorities arrays
 *  - `chat_reply`    events → drained into text
 *
 * If the server is unreachable we throw — the orchestrator falls back to
 * heuristics-only mode and surfaces a clear "start the sidecar" message.
 */
export async function runLLMOrchestrator(input: OrchestratorRunInput): Promise<OrchestratorRunOutput> {
  const health = await isServerHealthy();
  if (!health.ok) {
    throw new Error(
      `EmailSignal sidecar is not reachable (${health.error ?? 'unknown'}). ` +
        `Start it with "npm run server" in the repo, or configure the URL in Settings.`
    );
  }
  if (!health.info?.hasOpenAIKey) {
    throw new Error(
      'EmailSignal sidecar is running but OPENAI_API_KEY is not set on the server. ' +
        'Add it to server/.env and restart the sidecar.'
    );
  }

  const clutter: ClutterFinding[] = [];
  const priorities: PriorityFinding[] = [];
  let text: string | undefined;

  if (input.candidates?.length) {
    for await (const ev of sseFetch('/orchestrate/classify', {
      turnId: input.turnId,
      candidates: input.candidates,
    })) {
      if (ev.type === 'trace') {
        const parsed = AgentTraceEventSchema.safeParse(ev.data);
        if (parsed.success) await recordTrace(parsed.data);
      } else if (ev.type === 'classification') {
        for (const f of ev.data.clutter ?? []) {
          const r = ClutterFindingSchema.safeParse(f);
          if (r.success) clutter.push(r.data);
        }
        for (const f of ev.data.priorities ?? []) {
          const r = PriorityFindingSchema.safeParse(f);
          if (r.success) priorities.push(r.data);
        }
      } else if (ev.type === 'error') {
        await recordTrace({
          kind: 'error',
          agent: AGENT_NAMES.orchestrator,
          turnId: input.turnId,
          message: ev.data.message,
        });
      }
    }
  }

  if (input.userMessage) {
    for await (const ev of sseFetch('/orchestrate/chat', {
      turnId: input.turnId,
      message: input.userMessage,
      context: input.context,
    })) {
      if (ev.type === 'trace') {
        const parsed = AgentTraceEventSchema.safeParse(ev.data);
        if (parsed.success) await recordTrace(parsed.data);
      } else if (ev.type === 'chat_reply') {
        text = ev.data.text;
      } else if (ev.type === 'error') {
        await recordTrace({
          kind: 'error',
          agent: AGENT_NAMES.orchestrator,
          turnId: input.turnId,
          message: ev.data.message,
        });
      }
    }
  }

  return { clutter, priorities, text };
}

/**
 * Synthesis pass: runs AFTER classification. Asks the sidecar to fold the
 * classified priorities (plus their bodies) into ActionItems. Falls back to
 * the deterministic local synthesizer when the sidecar is unavailable so the
 * Today tab still renders something useful in heuristics-only mode.
 */
export async function runActionItemSynthesis(input: SynthesisRunInput): Promise<ActionItem[]> {
  const localFallback = (): ActionItem[] =>
    sortActionItems(
      synthesizeActionItemsLocal({
        priorities: input.priorities,
        clutter: input.clutter,
        candidates: input.candidates,
      })
    );

  if (input.priorities.length === 0) return [];

  const health = await isServerHealthy();
  if (!health.ok || !health.info?.hasOpenAIKey) {
    return localFallback();
  }

  const items: ActionItem[] = [];
  try {
    for await (const ev of sseFetch('/orchestrate/synthesize', {
      turnId: input.turnId,
      priorities: input.priorities,
      clutter: input.clutter,
      candidates: input.candidates.map((c) => ({
        id: c.id,
        threadId: c.threadId,
        from: c.from,
        subject: c.subject,
        snippet: c.snippet,
        bodyExcerpt: c.bodyExcerpt,
      })),
    })) {
      if (ev.type === 'trace') {
        const parsed = AgentTraceEventSchema.safeParse(ev.data);
        if (parsed.success) await recordTrace(parsed.data);
      } else if (ev.type === 'action_items') {
        for (const it of ev.data.items ?? []) {
          const r = ActionItemSchema.safeParse(it);
          if (r.success) items.push(r.data);
        }
      } else if (ev.type === 'error') {
        await recordTrace({
          kind: 'error',
          agent: AGENT_NAMES.orchestrator,
          turnId: input.turnId,
          message: ev.data.message,
        });
      }
    }
  } catch {
    return localFallback();
  }

  if (items.length === 0) return localFallback();
  return sortActionItems(items);
}
