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
import { initWeave, recordTrace, startSession } from '@/weave/tracing';
import { AGENT_NAMES } from './agent-defs';
import { runLLMOrchestrator } from './llm-runner';
import { log } from '@/common/log';

interface OrchestratorTurnInput {
  trigger: 'scan' | 'brief' | 'chat' | 'approval' | 'periodic';
  scan?: ScanResult;
  userText?: string;
  approval?: ApprovalRecord;
  sourceTabId?: number;
}

/**
 * Single entry point used by the service worker. The orchestrator:
 *  1. Aborts immediately if the kill switch is on.
 *  2. Records a turn_start event.
 *  3. Routes based on trigger.
 *  4. Always records a turn_end event (even on error).
 *
 * The actual LLM agent execution happens in `runLLMOrchestrator` so this
 * function can fall back to pure heuristics when no API key is configured.
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
    switch (input.trigger) {
      case 'scan':
        if (input.scan) await handleScan(input.scan, turnId);
        break;
      case 'brief':
        await handleBrief(turnId);
        break;
      case 'chat':
        if (input.userText) await handleChat(input.userText, turnId);
        break;
      case 'approval':
        if (input.approval) await handleApproval(input.approval, turnId, input.sourceTabId);
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

async function handleScan(scan: ScanResult, turnId: string): Promise<void> {
  await recordTrace({
    kind: 'classification_batch',
    agent: AGENT_NAMES.inboxScanner,
    turnId,
    data: { candidates: scan.candidates.length },
  });

  // ---- pass 1: cheap heuristics in parallel ----
  const heuristicClutter: ClutterFinding[] = [];
  const heuristicPriority: PriorityFinding[] = [];
  const ambiguous: EmailCandidate[] = [];
  for (const c of scan.candidates) {
    const cl = quickClutterPass(c);
    const pr = quickPriorityPass(c);
    if (cl) heuristicClutter.push(cl);
    if (pr) heuristicPriority.push(pr);
    if (!cl && !pr) ambiguous.push(c);
  }

  // ---- pass 2: LLM agents for ambiguous batch (via local sidecar) ----
  let clutter = heuristicClutter;
  let priorities = heuristicPriority;
  if (ambiguous.length > 0) {
    try {
      const llmResult = await runLLMOrchestrator({
        turnId,
        candidates: ambiguous,
      });
      clutter = [...clutter, ...llmResult.clutter];
      priorities = [...priorities, ...llmResult.priorities];
    } catch (err) {
      log.warn('LLM classification failed; using heuristics only', err);
      await recordTrace({ kind: 'error', turnId, message: `LLM fallback: ${(err as Error).message}` });
    }
  }

  const groups = groupClutter(clutter, scan.candidates);
  await broadcast({
    kind: 'bg/classification',
    clutter,
    groups,
    priorities,
  });

  // Auto-propose unsubscribe actions (status=pending; user must approve in UI)
  for (const g of groups) {
    if (g.suggestedActions.includes('unsubscribe')) {
      const emailId = g.emailIds[0]!;
      const candidate = scan.candidates.find((c) => c.id === emailId);
      const href = candidate?.unsubscribeLinkHrefs[0];
      if (!href) continue;
      await proposeAction({
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
      });
    }
  }
}

async function handleBrief(turnId: string): Promise<void> {
  await recordTrace({ kind: 'agent_start', agent: AGENT_NAMES.brief, turnId });
  // The DailyBriefAgent is informed by what's already in memory from recent
  // classification batches. In V1 we synthesize from the ledger + last
  // classification cache held in chrome.storage.
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
  await recordTrace({ kind: 'agent_end', agent: AGENT_NAMES.brief, turnId });
}

async function handleChat(text: string, turnId: string): Promise<void> {
  await recordTrace({ kind: 'agent_start', agent: AGENT_NAMES.orchestrator, turnId, message: text });
  try {
    const reply = await runLLMOrchestrator({ turnId, userMessage: text });
    await broadcast({ kind: 'bg/chat_reply', turnId, text: reply.text ?? '…' });
  } catch (err) {
    await broadcast({
      kind: 'bg/chat_reply',
      turnId,
      text: `(${(err as Error).message})`,
    });
  }
}

async function handleApproval(
  approval: ApprovalRecord,
  turnId: string,
  sourceTabId: number | undefined
): Promise<void> {
  const ledger = await getLedger();
  const entry = ledger.find((e) => e.proposed.id === approval.proposedActionId);
  if (!entry) {
    await recordTrace({ kind: 'error', turnId, message: 'approval references unknown action' });
    return;
  }
  await appendLedger({ proposedActionId: approval.proposedActionId, approval });
  await recordTrace({
    kind: approval.status === 'approved' ? 'approval_granted' : 'approval_rejected',
    turnId,
    data: { proposedActionId: approval.proposedActionId },
  });
  if (approval.status !== 'approved') return;

  if (await isDryRun()) {
    await appendLedger({
      proposedActionId: approval.proposedActionId,
      executed: {
        ok: true,
        after: { dryRun: true },
      },
    });
    await recordTrace({
      kind: 'action_executed',
      turnId,
      message: 'dry-run skip',
      data: { proposedActionId: approval.proposedActionId },
    });
    return;
  }

  // Hand the action to the content script for execution.
  const action = entry.proposed;
  if (typeof chrome !== 'undefined' && sourceTabId === undefined) {
    const [tab] = await chrome.tabs.query({ active: true, url: 'https://mail.google.com/*' });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { kind: 'bg/execute_dom_action', action });
    }
  } else if (sourceTabId !== undefined) {
    await chrome.tabs.sendMessage(sourceTabId, { kind: 'bg/execute_dom_action', action });
  }
}

// ---- helpers ----

async function proposeAction(partial: Omit<ProposedAction, 'id' | 'proposedAt' | 'expiresAt'>): Promise<void> {
  const action: ProposedAction = ProposedActionSchema.parse({
    ...partial,
    id: nanoid(),
    proposedAt: new Date().toISOString(),
  });
  const policy = checkPolicy(action);
  if (!policy.allow) {
    await recordTrace({
      kind: 'action_blocked',
      agent: AGENT_NAMES.policy,
      message: policy.reason ?? 'blocked',
      data: { actionId: action.id, type: action.type },
    });
    return;
  }
  await recordProposed(action);
  await recordTrace({
    kind: 'approval_requested',
    agent: action.proposedBy,
    data: { actionId: action.id, type: action.type, risk: action.risk },
  });
  await broadcast({ kind: 'bg/proposed_action', action });
}

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
