import { nanoid } from 'nanoid';
import {
  ApprovalRecord,
  ClutterFinding,
  ClutterSenderGroup,
  ClutterSenderGroupSchema,
  DailyBrief,
  DailyBriefSchema,
  EmailCandidate,
  PriorityFinding,
  ProposedAction,
  ProposedActionSchema,
  ScanResult,
} from '@schemas/index';
import { quickClutterPass, quickPriorityPass } from './heuristics';
import { checkPolicy } from './policy';
import { getMemoryStore } from '@/memory';
import { isDryRun, isKillSwitchOn, USER_ID } from './runtime';
import { recordProposed, appendLedger, getLedger } from '@/ledger/local-ledger';
import { initWeave, recordTrace, startSession, getSessionId } from '@/weave/tracing';
import { AGENT_NAMES, AGENT_REGISTRY, AgentName } from './agent-defs';
import {
  AgentContext,
  AgentHandoffPayload,
  AgentHandoffPayloadSchema,
  AgentRunResult,
  ApprovalDecision,
  PolicyDecision,
  PolicyDecisionSchema,
} from './types';
import { runLLMOrchestrator, runActionItemSynthesis } from './llm-runner';
import { applyVisibilityFloor } from './synthesis';
import { log } from '@/common/log';

interface OrchestratorTurnInput {
  trigger: 'scan' | 'brief' | 'chat' | 'approval' | 'periodic';
  scan?: ScanResult;
  userText?: string;
  approval?: ApprovalRecord;
  sourceTabId?: number;
}

/** Size of each parallel classifier batch. */
const BATCH_SIZE = 8;

/**
 * Single entry point used by the service worker.
 *
 * The orchestrator never executes email actions itself — it only routes work
 * to specialist agents and gates every action through the policy + approval
 * pipeline. Each delegation is emitted as a typed `agent_handoff` trace so the
 * cockpit (and Weave) can render the full timeline.
 */
export async function runOrchestratorTurn(input: OrchestratorTurnInput): Promise<void> {
  if (await isKillSwitchOn()) {
    log.warn('kill switch active — aborting turn');
    await recordTrace({ kind: 'action_blocked', message: 'kill switch active' });
    return;
  }

  const turnId = nanoid();
  startSession();
  await initWeave();
  await recordTrace({
    kind: 'turn_start',
    agent: AGENT_NAMES.orchestrator,
    turnId,
    data: { trigger: input.trigger },
  });
  const started = Date.now();

  try {
    const ctx = await buildContext(turnId);
    switch (input.trigger) {
      case 'scan':
        if (input.scan) await handleScan(input.scan, ctx);
        break;
      case 'brief':
        await handleBrief(ctx);
        break;
      case 'chat':
        if (input.userText) await handleChat(input.userText, ctx);
        break;
      case 'approval':
        if (input.approval) await handleApproval(input.approval, ctx, input.sourceTabId);
        break;
      case 'periodic':
        // Periodic ticks are handled by the alarm in the service worker, which
        // requests a fresh scan from any open Gmail tab. Nothing to do here.
        break;
    }
  } catch (err) {
    log.error('orchestrator turn error', err);
    await recordTrace({
      kind: 'error',
      turnId,
      message: (err as Error).message,
    });
  } finally {
    await recordTrace({
      kind: 'turn_end',
      turnId,
      elapsedMs: Date.now() - started,
    });
  }
}

async function buildContext(turnId: string): Promise<AgentContext> {
  return {
    turnId,
    sessionId: getSessionId(),
    userId: USER_ID,
    dryRun: await isDryRun(),
    killSwitch: false,
    preferences: [],
  };
}

// ---------------- Scan turn ----------------

async function handleScan(scan: ScanResult, ctx: AgentContext): Promise<void> {
  await recordTrace({
    kind: 'classification_batch',
    agent: AGENT_NAMES.inboxScanner,
    turnId: ctx.turnId,
    data: { candidates: scan.candidates.length },
  });

  // 1) MemoryAgent FIRST — preferences influence downstream ranking.
  const memoryRun = await runMemoryAgent(ctx);
  ctx.preferences = memoryRun.output ?? [];

  // 2) Parallel handoffs to clutter + priority classifiers, batched.
  const clutterRun = await runClutterAgentParallel(scan.candidates, ctx);
  const priorityRun = await runPriorityAgentParallel(scan.candidates, ctx);
  const clutter = clutterRun.output ?? [];
  const priorities = priorityRun.output ?? [];

  // 3) Apply preference filters (ignored_sender — never surface).
  const filteredPriorities = filterByPreferences(priorities, ctx);

  const groups = groupClutter(clutter, scan.candidates);
  await broadcast({
    kind: 'bg/classification',
    clutter,
    groups,
    priorities: filteredPriorities,
  });

  // 3a) Synthesis: fold priorities into ActionItems for the Today tab.
  try {
    const items = await runActionItemSynthesis({
      turnId: ctx.turnId,
      priorities: filteredPriorities,
      clutter,
      candidates: scan.candidates,
    });
    const visible = applyVisibilityFloor(items);
    await broadcast({ kind: 'bg/action_items', items: visible });
  } catch (err) {
    log.warn('action-item synthesis failed', err);
    await broadcast({ kind: 'bg/action_items', items: [] });
  }

  // 4) For every suggested unsubscribe, propose an action — but only after
  //    ActionPolicyAgent gives a verdict. The orchestrator never bypasses this.
  for (const g of groups) {
    if (!g.suggestedActions.includes('unsubscribe')) continue;
    const emailId = g.emailIds[0]!;
    const candidate = scan.candidates.find((c) => c.id === emailId);
    const href = candidate?.unsubscribeLinkHrefs[0];
    if (!href) continue;

    const partial: Omit<ProposedAction, 'id' | 'proposedAt' | 'expiresAt'> = {
      emailId,
      threadId: candidate?.threadId,
      type: 'click_unsubscribe',
      title: `Unsubscribe from ${g.senderDisplay}`,
      rationale: `Found ${g.count} ${g.category.replace('_', ' ')} message(s) from ${g.senderDomain}. ${g.rationale}`,
      proposedBy: AGENT_NAMES.unsubscribe,
      requiredPermission: 'dom_click_unsubscribe',
      reversible: false,
      risk: 'medium',
      approvalStatus: 'pending',
      params: { unsubscribeHref: href, senderDomain: g.senderDomain },
    };
    await proposeAndGate(partial, ctx);
  }
}

// ---------------- Brief turn ----------------

async function handleBrief(ctx: AgentContext): Promise<void> {
  const handoff = makeHandoff(
    AGENT_NAMES.orchestrator,
    AGENT_NAMES.brief,
    'compose_brief',
    ctx.turnId,
    { clutter: [], priorities: [] }
  );
  await emitHandoff(handoff);

  const ledger = await getLedger();
  const recentBriefSections = [
    { kind: 'needs_reply' as const, title: 'Needs reply', summary: 'Items requiring your response.', items: [], clutterGroups: [], proposedActions: [] },
    { kind: 'money' as const, title: 'Money & payment reminders', summary: 'Bills and payment reminders surfaced today.', items: [], clutterGroups: [], proposedActions: [] },
    { kind: 'scheduling' as const, title: 'Scheduling & logistics', summary: '', items: [], clutterGroups: [], proposedActions: [] },
    { kind: 'job_career' as const, title: 'Job & career', summary: '', items: [], clutterGroups: [], proposedActions: [] },
    { kind: 'fyi_important' as const, title: 'FYI but important', summary: '', items: [], clutterGroups: [], proposedActions: [] },
    { kind: 'clutter_cleanup' as const, title: 'Clutter cleanup opportunities', summary: `${ledger.filter((e) => e.proposed.type === 'click_unsubscribe').length} unsubscribe actions pending review.`, items: [], clutterGroups: [], proposedActions: [] },
  ];
  const brief: DailyBrief = DailyBriefSchema.parse({
    id: nanoid(),
    generatedAt: new Date().toISOString(),
    headline: 'Today in your inbox',
    sections: recentBriefSections,
    scanResultIds: [],
  });
  await broadcast({ kind: 'bg/brief', brief });
  await recordTrace({ kind: 'agent_end', agent: AGENT_NAMES.brief, turnId: ctx.turnId });
}

// ---------------- Chat turn ----------------

async function handleChat(text: string, ctx: AgentContext): Promise<void> {
  await recordTrace({
    kind: 'agent_start',
    agent: AGENT_NAMES.orchestrator,
    turnId: ctx.turnId,
    message: text,
  });
  try {
    const reply = await runLLMOrchestrator({ turnId: ctx.turnId, userMessage: text });
    await broadcast({ kind: 'bg/chat_reply', turnId: ctx.turnId, text: reply.text ?? '…' });
  } catch (err) {
    await broadcast({
      kind: 'bg/chat_reply',
      turnId: ctx.turnId,
      text: `(${(err as Error).message})`,
    });
  }
}

// ---------------- Approval turn ----------------

async function handleApproval(
  approval: ApprovalRecord,
  ctx: AgentContext,
  sourceTabId: number | undefined
): Promise<void> {
  const ledger = await getLedger();
  const entry = ledger.find((e) => e.proposed.id === approval.proposedActionId);
  if (!entry) {
    await recordTrace({
      kind: 'error',
      turnId: ctx.turnId,
      message: 'approval references unknown action',
    });
    return;
  }
  await appendLedger({ proposedActionId: approval.proposedActionId, approval });
  const approvalDecision: ApprovalDecision = {
    proposedActionId: approval.proposedActionId,
    status: approval.status === 'approved' ? 'approved' : 'rejected',
    approvedBy: approval.approvedBy ?? 'user',
    approvedAt: approval.approvedAt ?? new Date().toISOString(),
    note: approval.note,
  };
  await recordTrace({
    kind: approval.status === 'approved' ? 'approval_granted' : 'approval_rejected',
    turnId: ctx.turnId,
    data: { proposedActionId: approval.proposedActionId },
  });

  if (approvalDecision.status !== 'approved') {
    // Rejected attempts still go through AuditLedgerAgent for the timeline.
    await runAuditLedgerAgent(
      { proposedActionId: approval.proposedActionId, outcome: 'rejected' },
      ctx
    );
    return;
  }

  // Approved path. Always emit execute_unsubscribe → UnsubscribeAgent and
  // always emit log_audit → AuditLedgerAgent afterward, whether execution
  // succeeded or failed.
  const result = await runUnsubscribeAgent(
    { action: entry.proposed, approval, sourceTabId, ctx }
  );

  await runAuditLedgerAgent(
    {
      proposedActionId: approval.proposedActionId,
      outcome: result.ok ? 'executed' : 'failed',
      detail: result.error,
    },
    ctx
  );
}

// ---------------- Memory agent ----------------

async function runMemoryAgent(ctx: AgentContext): Promise<AgentRunResult<typeof ctx.preferences>> {
  const handoff = makeHandoff(
    AGENT_NAMES.orchestrator,
    AGENT_NAMES.memory,
    'recall_memory',
    ctx.turnId,
    { userId: ctx.userId }
  );
  await emitHandoff(handoff);
  const start = Date.now();
  try {
    const store = await getMemoryStore();
    const prefs = await store.listPreferences(ctx.userId);
    await recordTrace({
      kind: 'agent_end',
      agent: AGENT_NAMES.memory,
      turnId: ctx.turnId,
      message: `${prefs.length} preferences recalled`,
    });
    return finishRun(AGENT_NAMES.memory, start, prefs, [handoff]);
  } catch (err) {
    return failRun(AGENT_NAMES.memory, start, err, [handoff]);
  }
}

// ---------------- Clutter / Priority agents (parallel batches) ----------------

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches.length === 0 ? [[]] : batches;
}

async function runClutterAgentParallel(
  candidates: EmailCandidate[],
  ctx: AgentContext
): Promise<AgentRunResult<ClutterFinding[]>> {
  const start = Date.now();
  // Heuristic pass first; only ambiguous candidates need the LLM.
  const heuristic: ClutterFinding[] = [];
  const ambiguous: EmailCandidate[] = [];
  for (const c of candidates) {
    const cl = quickClutterPass(c);
    if (cl) heuristic.push(cl);
    else ambiguous.push(c);
  }

  const batches = chunk(ambiguous, BATCH_SIZE);
  const handoffs: AgentHandoffPayload[] = batches.map((batch, i) =>
    makeHandoff(
      AGENT_NAMES.orchestrator,
      AGENT_NAMES.clutter,
      'classify_clutter',
      ctx.turnId,
      {
        batchIndex: i,
        batchCount: batches.length,
        candidates: batch,
        preferences: ctx.preferences,
      }
    )
  );
  for (const h of handoffs) await emitHandoff(h);

  if (ambiguous.length === 0) {
    return finishRun(AGENT_NAMES.clutter, start, heuristic, handoffs);
  }

  try {
    // Parallelize batches over the sidecar. The sidecar in turn runs each
    // batch under a fresh agent invocation, so true parallelism is preserved.
    const settled = await Promise.allSettled(
      batches.map((batch) =>
        runLLMOrchestrator({ turnId: ctx.turnId, candidates: batch })
      )
    );
    const out = [...heuristic];
    for (const r of settled) {
      if (r.status === 'fulfilled') out.push(...r.value.clutter);
      else {
        await recordTrace({
          kind: 'error',
          agent: AGENT_NAMES.clutter,
          turnId: ctx.turnId,
          message: `clutter batch failed: ${(r.reason as Error).message}`,
        });
      }
    }
    await recordTrace({
      kind: 'agent_end',
      agent: AGENT_NAMES.clutter,
      turnId: ctx.turnId,
      message: `${out.length} findings across ${batches.length} batches`,
    });
    return finishRun(AGENT_NAMES.clutter, start, out, handoffs);
  } catch (err) {
    log.warn('clutter classification failed; using heuristics only', err);
    return finishRun(AGENT_NAMES.clutter, start, heuristic, handoffs, (err as Error).message);
  }
}

async function runPriorityAgentParallel(
  candidates: EmailCandidate[],
  ctx: AgentContext
): Promise<AgentRunResult<PriorityFinding[]>> {
  const start = Date.now();
  const heuristic: PriorityFinding[] = [];
  const ambiguous: EmailCandidate[] = [];
  for (const c of candidates) {
    const pr = quickPriorityPass(c);
    if (pr) heuristic.push(pr);
    else ambiguous.push(c);
  }

  const batches = chunk(ambiguous, BATCH_SIZE);
  const handoffs: AgentHandoffPayload[] = batches.map((batch, i) =>
    makeHandoff(
      AGENT_NAMES.orchestrator,
      AGENT_NAMES.priority,
      'classify_priority',
      ctx.turnId,
      {
        batchIndex: i,
        batchCount: batches.length,
        candidates: batch,
        preferences: ctx.preferences,
      }
    )
  );
  for (const h of handoffs) await emitHandoff(h);

  if (ambiguous.length === 0) {
    return finishRun(AGENT_NAMES.priority, start, heuristic, handoffs);
  }

  try {
    const settled = await Promise.allSettled(
      batches.map((batch) =>
        runLLMOrchestrator({ turnId: ctx.turnId, candidates: batch })
      )
    );
    const out = [...heuristic];
    for (const r of settled) {
      if (r.status === 'fulfilled') out.push(...r.value.priorities);
      else {
        await recordTrace({
          kind: 'error',
          agent: AGENT_NAMES.priority,
          turnId: ctx.turnId,
          message: `priority batch failed: ${(r.reason as Error).message}`,
        });
      }
    }
    await recordTrace({
      kind: 'agent_end',
      agent: AGENT_NAMES.priority,
      turnId: ctx.turnId,
      message: `${out.length} findings across ${batches.length} batches`,
    });
    return finishRun(AGENT_NAMES.priority, start, out, handoffs);
  } catch (err) {
    log.warn('priority classification failed; using heuristics only', err);
    return finishRun(AGENT_NAMES.priority, start, heuristic, handoffs, (err as Error).message);
  }
}

function filterByPreferences(
  priorities: PriorityFinding[],
  ctx: AgentContext
): PriorityFinding[] {
  const ignored = new Set(
    ctx.preferences
      .filter((p) => p.kind === 'ignored_sender' && typeof p.value === 'string')
      .map((p) => (p.value as string).toLowerCase())
  );
  if (ignored.size === 0) return priorities;
  return priorities.filter(
    (p) => !ignored.has(p.senderDisplay.toLowerCase())
  );
}

// ---------------- Policy + propose ----------------

/**
 * Single entry point for any action proposal. Routes through ActionPolicyAgent
 * (which calls the deterministic checkPolicy gate) BEFORE the user ever sees
 * an approval card. If blocked, AuditLedgerAgent still records the attempt.
 */
async function proposeAndGate(
  partial: Omit<ProposedAction, 'id' | 'proposedAt' | 'expiresAt'>,
  ctx: AgentContext
): Promise<ProposedAction | null> {
  const action: ProposedAction = ProposedActionSchema.parse({
    ...partial,
    id: nanoid(),
    proposedAt: new Date().toISOString(),
  });

  const verdict = await runPolicyAgent(action, ctx);
  if (!verdict.allow) {
    await recordTrace({
      kind: 'action_blocked',
      agent: AGENT_NAMES.policy,
      turnId: ctx.turnId,
      message: verdict.reason ?? 'blocked',
      data: { actionId: action.id, type: action.type, ruleId: verdict.ruleId },
    });
    await runAuditLedgerAgent(
      {
        proposedActionId: action.id,
        outcome: 'blocked',
        detail: verdict.reason ?? 'policy blocked',
      },
      ctx
    );
    return null;
  }

  await recordProposed(action);
  // Surface as an approval request (typed handoff to UnsubscribeAgent — but
  // the user gates the actual execution).
  const approvalHandoff = makeHandoff(
    AGENT_NAMES.orchestrator,
    AGENT_NAMES.unsubscribe,
    'request_approval',
    ctx.turnId,
    { action }
  );
  await emitHandoff(approvalHandoff);
  await recordTrace({
    kind: 'approval_requested',
    agent: action.proposedBy,
    turnId: ctx.turnId,
    data: { actionId: action.id, type: action.type, risk: action.risk },
  });
  await broadcast({ kind: 'bg/proposed_action', action });
  return action;
}

async function runPolicyAgent(
  action: ProposedAction,
  ctx: AgentContext
): Promise<PolicyDecision> {
  const handoff = makeHandoff(
    AGENT_NAMES.orchestrator,
    AGENT_NAMES.policy,
    'validate_action',
    ctx.turnId,
    { action }
  );
  await emitHandoff(handoff);
  const gate = checkPolicy(action);
  const decision: PolicyDecision = PolicyDecisionSchema.parse({
    allow: gate.allow,
    ruleId: gate.allow ? 'allowed' : 'policy_gate_denied',
    reason: gate.reason,
    actionId: action.id,
    decidedBy: AGENT_NAMES.policy,
    decidedAt: new Date().toISOString(),
  });
  await recordTrace({
    kind: 'agent_end',
    agent: AGENT_NAMES.policy,
    turnId: ctx.turnId,
    message: decision.allow ? 'allowed' : `blocked: ${decision.reason ?? ''}`,
    data: { actionId: action.id, allow: decision.allow },
  });
  return decision;
}

// ---------------- Unsubscribe agent ----------------

interface UnsubscribeAgentInput {
  action: ProposedAction;
  approval: ApprovalRecord;
  sourceTabId: number | undefined;
  ctx: AgentContext;
}

interface UnsubscribeAgentResult {
  ok: boolean;
  error?: string;
  dryRun: boolean;
}

async function runUnsubscribeAgent(
  input: UnsubscribeAgentInput
): Promise<UnsubscribeAgentResult> {
  const { action, approval, sourceTabId, ctx } = input;
  const handoff = makeHandoff(
    AGENT_NAMES.orchestrator,
    AGENT_NAMES.unsubscribe,
    'execute_unsubscribe',
    ctx.turnId,
    { action, approval }
  );
  await emitHandoff(handoff);

  // Re-validate at the executor boundary; defense in depth.
  if (action.type !== 'click_unsubscribe') {
    return { ok: false, dryRun: ctx.dryRun, error: 'unsupported action type' };
  }
  const href = action.params['unsubscribeHref'];
  if (typeof href !== 'string' || !/^https:\/\//.test(href)) {
    return { ok: false, dryRun: ctx.dryRun, error: 'invalid unsubscribe href' };
  }

  if (ctx.dryRun) {
    await appendLedger({
      proposedActionId: action.id,
      executed: { ok: true, after: { dryRun: true } },
    });
    await recordTrace({
      kind: 'action_executed',
      agent: AGENT_NAMES.unsubscribe,
      turnId: ctx.turnId,
      message: 'dry-run skip',
      data: { proposedActionId: action.id },
    });
    return { ok: true, dryRun: true };
  }

  // Hand the action to the content script for execution. Errors here count as
  // "failed approved attempts" — they still go to the ledger via AuditLedgerAgent.
  try {
    if (typeof chrome !== 'undefined' && sourceTabId === undefined) {
      const [tab] = await chrome.tabs.query({ active: true, url: 'https://mail.google.com/*' });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { kind: 'bg/execute_dom_action', action });
      } else {
        return { ok: false, dryRun: false, error: 'no Gmail tab open' };
      }
    } else if (sourceTabId !== undefined) {
      await chrome.tabs.sendMessage(sourceTabId, { kind: 'bg/execute_dom_action', action });
    }
    await recordTrace({
      kind: 'action_executed',
      agent: AGENT_NAMES.unsubscribe,
      turnId: ctx.turnId,
      data: { proposedActionId: action.id },
    });
    return { ok: true, dryRun: false };
  } catch (err) {
    await recordTrace({
      kind: 'error',
      agent: AGENT_NAMES.unsubscribe,
      turnId: ctx.turnId,
      message: (err as Error).message,
      data: { proposedActionId: action.id },
    });
    return { ok: false, dryRun: false, error: (err as Error).message };
  }
}

// ---------------- Audit ledger agent ----------------

interface AuditLogInput {
  proposedActionId: string;
  outcome: 'approved' | 'rejected' | 'blocked' | 'executed' | 'failed';
  detail?: string;
}

export async function runAuditLedgerAgent(
  input: AuditLogInput,
  ctx: AgentContext
): Promise<AgentRunResult<void>> {
  const start = Date.now();
  const handoff = makeHandoff(
    AGENT_NAMES.orchestrator,
    AGENT_NAMES.audit,
    'log_audit',
    ctx.turnId,
    {
      proposedActionId: input.proposedActionId,
      outcome: input.outcome,
      detail: input.detail,
    }
  );
  await emitHandoff(handoff);

  // Failed attempts are ALWAYS recorded — that's the contract.
  if (input.outcome === 'failed') {
    await appendLedger({
      proposedActionId: input.proposedActionId,
      executed: { ok: false, error: input.detail ?? 'unknown' },
    });
  }
  // Blocked actions never reached the ledger via recordProposed (we drop early
  // when policy denies). We still emit the trace so the timeline shows the
  // attempt — the audit agent's responsibility is the trace, not synthesizing
  // ledger rows for attempts that never happened.

  await recordTrace({
    kind: 'agent_end',
    agent: AGENT_NAMES.audit,
    turnId: ctx.turnId,
    data: { proposedActionId: input.proposedActionId, outcome: input.outcome },
  });
  return finishRun(AGENT_NAMES.audit, start, undefined, [handoff]);
}

// ---------------- Handoff helpers ----------------

function makeHandoff(
  from: AgentName,
  to: AgentName,
  kind: AgentHandoffPayload['kind'],
  turnId: string,
  rest: Record<string, unknown>
): AgentHandoffPayload {
  return AgentHandoffPayloadSchema.parse({
    fromAgent: from,
    toAgent: to,
    kind,
    turnId,
    createdAt: new Date().toISOString(),
    ...rest,
  });
}

/**
 * Emits a typed handoff to the trace timeline (and to Weave, via recordTrace
 * pushing into the optional weave processor). The full payload is preserved
 * in `data` so downstream replay can re-run the same handoff deterministically.
 */
export async function emitHandoff(payload: AgentHandoffPayload): Promise<void> {
  // Guard against registry drift: agents must declare each handoff kind they
  // emit. This is the orchestrator-side enforcement that mirrors the
  // disallowedTools gate for tool calls.
  const spec = AGENT_REGISTRY[payload.fromAgent as AgentName];
  if (spec && spec.handoffsTo.length > 0 && !spec.handoffsTo.includes(payload.kind)) {
    await recordTrace({
      kind: 'action_blocked',
      agent: AGENT_NAMES.policy,
      turnId: payload.turnId,
      message: `agent ${payload.fromAgent} not allowed to emit handoff ${payload.kind}`,
    });
    return;
  }
  await recordTrace({
    kind: 'agent_handoff',
    agent: payload.fromAgent,
    turnId: payload.turnId,
    message: `${payload.fromAgent} → ${payload.toAgent}: ${payload.kind}`,
    data: summarizeHandoffForTrace(payload),
  });
}

/**
 * Trace storage caps at 500 events; full EmailCandidate batches would blow
 * the cap quickly. Keep IDs + counts + key fields so the cockpit can render
 * a useful timeline without shipping body excerpts into chrome.storage.
 */
function summarizeHandoffForTrace(p: AgentHandoffPayload): Record<string, unknown> {
  const base = {
    fromAgent: p.fromAgent,
    toAgent: p.toAgent,
    kind: p.kind,
  };
  switch (p.kind) {
    case 'classify_clutter':
    case 'classify_priority':
      return {
        ...base,
        batchIndex: p.batchIndex,
        batchCount: p.batchCount,
        candidateIds: p.candidates.map((c) => c.id),
        preferenceCount: p.preferences.length,
      };
    case 'normalize_candidates':
      return { ...base, candidateIds: p.candidates.map((c) => c.id) };
    case 'recall_memory':
      return { ...base, userId: p.userId };
    case 'validate_action':
    case 'request_approval':
      return { ...base, actionId: p.action.id, type: p.action.type };
    case 'execute_unsubscribe':
      return {
        ...base,
        actionId: p.action.id,
        approvalStatus: p.approval.status,
      };
    case 'log_audit':
      return {
        ...base,
        proposedActionId: p.proposedActionId,
        outcome: p.outcome,
        detail: p.detail,
      };
    case 'compose_brief':
      return {
        ...base,
        clutterCount: p.clutter.length,
        priorityCount: p.priorities.length,
      };
  }
}

function finishRun<T>(
  agent: AgentName,
  start: number,
  output: T,
  handoffs: AgentHandoffPayload[],
  error?: string
): AgentRunResult<T> {
  const finishedAt = new Date();
  return {
    agent,
    ok: !error,
    output,
    error,
    startedAt: new Date(start).toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - start,
    handoffs,
  };
}

function failRun(
  agent: AgentName,
  start: number,
  err: unknown,
  handoffs: AgentHandoffPayload[]
): AgentRunResult<any> {
  return finishRun(agent, start, undefined, handoffs, (err as Error).message);
}

// ---------------- Misc helpers ----------------

function groupClutter(findings: ClutterFinding[], scan: EmailCandidate[]): ClutterSenderGroup[] {
  const bySender = new Map<string, ClutterFinding[]>();
  for (const f of findings) {
    const arr = bySender.get(f.senderDomain) ?? [];
    arr.push(f);
    bySender.set(f.senderDomain, arr);
  }
  const groups: ClutterSenderGroup[] = [];
  for (const [domain, list] of bySender) {
    const subjects = list
      .map((f) => scan.find((c) => c.id === f.emailId)?.subject)
      .filter((s): s is string => !!s)
      .slice(0, 5);
    groups.push(
      ClutterSenderGroupSchema.parse({
        senderDomain: domain,
        senderDisplay: list[0]!.senderDisplay,
        count: list.length,
        exampleSubjects: subjects,
        category: list[0]!.category,
        averageConfidence: list.reduce((s, f) => s + f.confidence, 0) / list.length,
        rationale: list[0]!.rationale,
        suggestedActions: Array.from(new Set(list.map((f) => f.suggestedAction))),
        emailIds: list.map((f) => f.emailId),
      })
    );
  }
  return groups.sort((a, b) => b.count - a.count);
}

async function broadcast(msg: import('@schemas/index').ExtMessage): Promise<void> {
  if (typeof chrome === 'undefined') return;
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    /* panel might be closed */
  }
}

// Memory recall: load preferences so other agents can read them.
export async function loadPreferenceContext() {
  const store = await getMemoryStore();
  return await store.listPreferences(USER_ID);
}

// ---------- Test surface ----------
// Exported so evals/handoffs.eval.ts can validate the policy + audit pipeline
// without spinning up the whole service worker.
export const __test = {
  proposeAndGate,
  runPolicyAgent,
  runUnsubscribeAgent,
  runAuditLedgerAgent,
  runMemoryAgent,
  filterByPreferences,
  buildContext,
};
