import { nanoid } from 'nanoid';
import {
  ApprovalRecord,
  ClutterFinding,
  ClutterSenderGroup,
  ClutterSenderGroupSchema,
  DailyBrief,
  DailyBriefSchema,
  Decision,
  EmailCandidate,
  ProposedAction,
  ProposedActionSchema,
  ScanResult,
} from '@schemas/index';
import { checkPolicy } from './policy';
import { getMemoryStore } from '@/memory';
import { isDryRun, isKillSwitchOn, USER_ID } from './runtime';
import { recordProposed, appendLedger, getLedger } from '@/ledger/local-ledger';
import { notifyScanResults } from '@/background/notifications';
import { recordTrace, startSession, getSessionId } from '@/weave/tracing';
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
import { classifyViaSidecar, chatViaSidecar } from './llm-runner';
import { log } from '@/common/log';

interface OrchestratorTurnInput {
  trigger: 'scan' | 'brief' | 'chat' | 'approval' | 'execute' | 'periodic';
  scan?: ScanResult;
  userText?: string;
  approval?: ApprovalRecord;
  /** For 'execute': a chat-approved action that isn't in the ledger yet. */
  action?: ProposedAction;
  sourceTabId?: number;
}

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
  await recordTrace({
    kind: 'turn_start',
    agent: AGENT_NAMES.orchestrator,
    turnId,
    data: { trigger: input.trigger },
  });
  // The scan lifecycle (reading → thinking) is driven by the service worker +
  // content script; other triggers announce their own "working" state here.
  if (input.trigger !== 'scan' && input.trigger !== 'periodic') {
    await broadcast({ kind: 'bg/turn_started', trigger: input.trigger });
  }
  const started = Date.now();
  let ok = true;

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
      case 'execute':
        if (input.action) await handleExecute(input.action, ctx, input.sourceTabId);
        break;
      case 'periodic':
        // Periodic ticks are handled by the alarm in the service worker, which
        // requests a fresh scan from any open Gmail tab. Nothing to do here.
        break;
    }
  } catch (err) {
    ok = false;
    log.error('orchestrator turn error', err);
    await recordTrace({
      kind: 'error',
      turnId,
      message: (err as Error).message,
    });
    // Surface the failure to the UI — the sidecar is required, so an error here
    // (e.g. it's not running) must be shown, never silently swallowed.
    await broadcast({ kind: 'bg/error', message: (err as Error).message });
  } finally {
    await recordTrace({
      kind: 'turn_end',
      turnId,
      elapsedMs: Date.now() - started,
    });
    if (input.trigger !== 'periodic') {
      await broadcast({ kind: 'bg/turn_done', ok, trigger: input.trigger });
    }
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
  // We have the emails — now we're thinking, not reading.
  await broadcast({ kind: 'bg/scan_progress', phase: 'thinking', loaded: scan.candidates.length });

  // 1) MemoryAgent FIRST — preferences influence synthesis + ranking.
  const memoryRun = await runMemoryAgent(ctx);
  ctx.preferences = memoryRun.output ?? [];

  // 2) All intelligence runs in the sidecar (OpenAI Agents SDK): clutter
  //    classification + decision synthesis. The extension never classifies.
  //    If the sidecar is down, this throws and the turn-level handler surfaces
  //    the error to the UI — there is no local fallback.
  await emitHandoff(
    makeHandoff(AGENT_NAMES.orchestrator, AGENT_NAMES.priority, 'classify_priority', ctx.turnId, {
      batchIndex: 0,
      batchCount: 1,
      candidates: scan.candidates,
      preferences: ctx.preferences,
    })
  );
  const { decisions, clutter, summary } = await classifyViaSidecar(ctx.turnId, scan.candidates, ctx.preferences);
  await recordTrace({
    kind: 'agent_end',
    agent: AGENT_NAMES.priority,
    turnId: ctx.turnId,
    message: `${decisions.length} decision(s), ${clutter.length} clutter`,
  });

  // 3) Apply preference filters (ignored_sender) + user dispositions
  //    (decisions the user marked handled, or snoozed until later).
  const prefFiltered = filterDecisionsByPreferences(decisions, ctx);
  const filtered = await filterDispositionedDecisions(prefFiltered);

  const groups = groupClutter(clutter, scan.candidates);
  await broadcast({ kind: 'bg/decisions', decisions: filtered, summary });
  await broadcast({
    kind: 'bg/classification',
    clutter,
    groups,
    priorities: [],
  });

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

  // 5) Opt-in scan-completion notifications (off by default; respects the kill
  //    switch). Never throws — a notification failure must not affect the scan.
  await notifyScanResults(filtered, groups);
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
    const reply = await chatViaSidecar(ctx.turnId, text);
    await broadcast({ kind: 'bg/chat_reply', turnId: ctx.turnId, text: reply });
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

  // Approved path. Run the (now general) action executor and always emit
  // log_audit → AuditLedgerAgent afterward, whether execution succeeded or
  // failed.
  const result = await runActionExecutor(
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

// ---------------- Execute turn (chat-approved actions) ----------------

/**
 * A chat approval card produced an action that the user just approved, but it
 * was never put through the scan→propose pipeline, so it isn't in the ledger.
 * Record it, run the deterministic policy gate, execute, and log every step —
 * so chat-initiated actions are first-class and fully audited, just like
 * scan-proposed ones. The user's approval on the card IS the gate.
 */
async function handleExecute(
  action: ProposedAction,
  ctx: AgentContext,
  sourceTabId: number | undefined
): Promise<void> {
  // 1) Record so it's visible in the activity log and appendLedger can attach
  //    approval/result rows to it.
  const proposedEntry = await recordProposed(action);
  await broadcastLedger(proposedEntry);

  // 2) Deterministic policy gate — same gate scan-proposed actions pass.
  const verdict = await runPolicyAgent(action, ctx);
  if (!verdict.allow) {
    const blocked = await appendLedger({
      proposedActionId: action.id,
      executed: { ok: false, error: `blocked: ${verdict.reason ?? 'policy'}` },
    });
    if (blocked) await broadcastLedger(blocked);
    await runAuditLedgerAgent(
      { proposedActionId: action.id, outcome: 'blocked', detail: verdict.reason },
      ctx
    );
    await broadcast({ kind: 'bg/error', message: `Blocked: ${verdict.reason ?? 'policy gate'}` });
    return;
  }

  // 3) Record the (already-given) approval, then execute.
  const approval: ApprovalRecord = {
    proposedActionId: action.id,
    status: 'approved',
    approvedBy: 'user',
    approvedAt: new Date().toISOString(),
  };
  const approvedEntry = await appendLedger({ proposedActionId: action.id, approval });
  if (approvedEntry) await broadcastLedger(approvedEntry);
  await recordTrace({
    kind: 'approval_granted',
    turnId: ctx.turnId,
    data: { proposedActionId: action.id },
  });

  const result = await runActionExecutor({ action, approval, sourceTabId, ctx });
  await runAuditLedgerAgent(
    {
      proposedActionId: action.id,
      outcome: result.ok ? 'executed' : 'failed',
      detail: result.error,
    },
    ctx
  );
}

/** Push a ledger row to the side panel so the activity log updates live. */
async function broadcastLedger(
  entry: import('@schemas/index').ActionLedgerEntry
): Promise<void> {
  await broadcast({ kind: 'bg/ledger_entry', entry });
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

// ---------------- Preference filtering ----------------

/** chrome.storage key for per-decision user dispositions (handled / snoozed).
 *  Shared with the service worker's `panel/decision_action` handler. */
const DECISION_STATE_KEY = 'emailsignal_decision_state';
interface DecisionDisposition {
  status: 'handled' | 'snoozed';
  until?: number;
}

/**
 * Drop decisions the user has dispositioned. A decision is suppressed only when
 * EVERY email folded into it is handled (forever) or snoozed (until its time),
 * so a multi-email decision that picks up a fresh message still surfaces.
 */
async function filterDispositionedDecisions(decisions: Decision[]): Promise<Decision[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return decisions;
  const state =
    ((await chrome.storage.local.get(DECISION_STATE_KEY))[DECISION_STATE_KEY] as
      | Record<string, DecisionDisposition>
      | undefined) ?? {};
  const now = Date.now();
  const suppressed = (emailId: string): boolean => {
    const d = state[emailId];
    if (!d) return false;
    if (d.status === 'handled') return true;
    return d.status === 'snoozed' && (d.until ?? 0) > now;
  };
  return decisions.filter((d) => d.emailIds.length === 0 || !d.emailIds.every(suppressed));
}

function filterDecisionsByPreferences(decisions: Decision[], ctx: AgentContext): Decision[] {
  const ignored = new Set(
    ctx.preferences
      .filter((p) => p.kind === 'ignored_sender' && typeof p.value === 'string')
      .map((p) => (p.value as string).toLowerCase())
  );
  if (ignored.size === 0) return decisions;
  return decisions.filter(
    (d) => !d.senders.some((s) => ignored.has(s.toLowerCase()))
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

  // Record first so EVERY proposed action — including ones the gate blocks —
  // is visible in the user's activity log, not just a trace event.
  const entry = await recordProposed(action);
  await broadcastLedger(entry);

  const verdict = await runPolicyAgent(action, ctx);
  if (!verdict.allow) {
    const blocked = await appendLedger({
      proposedActionId: action.id,
      executed: { ok: false, error: `blocked: ${verdict.reason ?? 'policy'}` },
    });
    if (blocked) await broadcastLedger(blocked);
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

// ---------------- Action executor ----------------

interface ActionExecutorInput {
  action: ProposedAction;
  approval: ApprovalRecord;
  sourceTabId: number | undefined;
  ctx: AgentContext;
}

interface ActionExecutorResult {
  ok: boolean;
  error?: string;
  dryRun: boolean;
}

/** Actions that change inbox state — these are skipped under dry-run. Reads and
 *  navigation (open_email, highlight, scroll, find_unsubscribe_link) always run. */
const MUTATING_TYPES = new Set<ProposedAction['type']>([
  'click_unsubscribe',
  'mark_read',
  'archive',
  'apply_label',
]);

/** Actions that need a resolved Gmail row/element selector to do anything. */
const NEEDS_SELECTOR = new Set<ProposedAction['type']>([
  'open_email',
  'highlight_element',
  'scroll_to_element',
  'mark_read',
  'archive',
  'apply_label',
]);

/**
 * Executes ANY approved action by handing it to the content script (which has a
 * real implementation for each type). This replaced the unsubscribe-only
 * executor that silently rejected open_email / mark_read / archive — the reason
 * chat actions like "open this message" never actually happened.
 */
async function runActionExecutor(
  input: ActionExecutorInput
): Promise<ActionExecutorResult> {
  const { action, approval, sourceTabId, ctx } = input;
  const handoff = makeHandoff(
    AGENT_NAMES.orchestrator,
    AGENT_NAMES.unsubscribe,
    'execute_unsubscribe',
    ctx.turnId,
    { action, approval }
  );
  await emitHandoff(handoff);

  // Defense in depth — validate the action can actually run before dispatching.
  if (action.type === 'click_unsubscribe') {
    const href = action.params['unsubscribeHref'];
    if (typeof href !== 'string' || !/^https:\/\//.test(href)) {
      return { ok: false, dryRun: ctx.dryRun, error: 'invalid unsubscribe href' };
    }
  }
  if (NEEDS_SELECTOR.has(action.type)) {
    const sel = (action.params['rowSelector'] ?? action.params['selector']) as string | undefined;
    if (typeof sel !== 'string' || !sel) {
      return {
        ok: false,
        dryRun: ctx.dryRun,
        error: "couldn't locate this email in the current Gmail view",
      };
    }
  }

  // Dry-run only suppresses state-changing actions.
  if (ctx.dryRun && MUTATING_TYPES.has(action.type)) {
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

  // Hand the action to the content script for execution on the user's Gmail tab.
  // The content script replies content/dom_action_result, which records the real
  // outcome in the ledger; success here means "dispatched".
  try {
    if (typeof chrome !== 'undefined') {
      let targetTab = sourceTabId;
      if (targetTab === undefined) {
        const [tab] = await chrome.tabs.query({ active: true, url: 'https://mail.google.com/*' });
        targetTab = tab?.id;
      }
      if (targetTab === undefined) {
        return { ok: false, dryRun: false, error: 'no Gmail tab open' };
      }
      await chrome.tabs.sendMessage(targetTab, { kind: 'bg/execute_dom_action', action });
    }
    await recordTrace({
      kind: 'action_executed',
      agent: AGENT_NAMES.unsubscribe,
      turnId: ctx.turnId,
      data: { proposedActionId: action.id, type: action.type },
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
        rowAnchors: list
          .map((f) => {
            const sel = scan.find((c) => c.id === f.emailId)?.domAnchor?.rowSelector;
            return sel ? { emailId: f.emailId, rowSelector: sel } : null;
          })
          .filter((a): a is { emailId: string; rowSelector: string } => a !== null),
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
  runActionExecutor,
  runAuditLedgerAgent,
  runMemoryAgent,
  filterDecisionsByPreferences,
  buildContext,
};
