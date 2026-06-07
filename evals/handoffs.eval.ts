import { nanoid } from 'nanoid';
import { __test as orch } from '../src/agents/orchestrator.js';
import { subscribeTrace } from '../src/weave/tracing.js';
import { clearLedger, getLedger } from '../src/ledger/local-ledger.js';
import { AgentTraceEvent, ApprovalRecord, ProposedAction } from '../src/schemas/index.js';
import { AGENT_NAMES } from '../src/agents/agent-defs.js';
import { logWeaveEvaluation } from './weave-eval.js';

interface Result {
  passed: number;
  total: number;
  failures: string[];
}

function check(failures: string[], cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

/** A trace-event predicate matching a specific handoff in a captured timeline. */
function hasHandoff(
  traces: AgentTraceEvent[],
  toAgent: string,
  kind: string,
  outcome?: string
): boolean {
  return traces.some(
    (t) =>
      t.kind === 'agent_handoff' &&
      t.data?.['toAgent'] === toAgent &&
      t.data?.['kind'] === kind &&
      (outcome === undefined || t.data?.['outcome'] === outcome)
  );
}

function unsubscribeAction(overrides: Partial<ProposedAction> = {}): Omit<
  ProposedAction,
  'id' | 'proposedAt' | 'expiresAt'
> {
  return {
    emailId: 'e1',
    threadId: 't1',
    type: 'click_unsubscribe',
    title: 'Unsubscribe from Acme',
    rationale: 'Promotional newsletter from acme.com',
    proposedBy: AGENT_NAMES.unsubscribe,
    requiredPermission: 'dom_click_unsubscribe',
    reversible: false,
    risk: 'medium',
    approvalStatus: 'pending',
    params: { unsubscribeHref: 'https://acme.com/unsub', senderDomain: 'acme.com' },
    ...overrides,
  } as Omit<ProposedAction, 'id' | 'proposedAt' | 'expiresAt'>;
}

/**
 * Eval: prove the multi-agent contract for action attempts.
 *
 * 1. Unauthorized attempts are blocked by ActionPolicyAgent and the timeline
 *    records both an `action_blocked` event AND a `log_audit` handoff with
 *    outcome='blocked'. The ledger contains NO entry for the blocked action.
 *
 * 2. Approved attempts go through UnsubscribeAgent and are ALWAYS appended to
 *    the audit ledger via AuditLedgerAgent — success OR failure.
 */
export async function runHandoffsEval(): Promise<Result> {
  // Force dry-run mode for deterministic test paths.
  process.env['EMAIL_SIGNAL_DRY_RUN'] = 'true';

  const failures: string[] = [];
  let passed = 0;
  const total = 6;

  // Scenarios run SEQUENTIALLY and capture their real trace timelines. They share
  // global state (the audit ledger + the process-wide trace subscription), so they
  // can NOT run concurrently — which is also why the Weave Evaluation below replays
  // these captured runs rather than re-executing each scenario inside a (parallel)
  // model op. The scorers still inspect the REAL captured trace events.
  const runs: Record<string, { traces: AgentTraceEvent[]; signals: Record<string, unknown> }> = {};

  // ---- Test 1: unauthorized blocked (http href on unsubscribe) ----
  await clearLedger();
  const traces1: AgentTraceEvent[] = [];
  const unsub1 = subscribeTrace((e) => traces1.push(e));
  try {
    const ctx = await orch.buildContext('turn-block');
    const blocked = await orch.proposeAndGate(
      unsubscribeAction({
        params: { unsubscribeHref: 'http://insecure.example/unsub', senderDomain: 'insecure.example' },
      }),
      ctx
    );

    check(failures, blocked === null, 'unauth: proposeAndGate should return null when policy blocks');

    const ledger = await getLedger();
    check(
      failures,
      ledger.length === 0,
      `unauth: blocked action must not be recorded in ledger (got ${ledger.length} entries)`
    );

    const blockedTrace = traces1.find(
      (t) => t.kind === 'action_blocked' && t.agent === AGENT_NAMES.policy
    );
    check(failures, !!blockedTrace, 'unauth: ActionPolicyAgent must emit action_blocked trace');

    const handoffToAudit = traces1.find(
      (t) =>
        t.kind === 'agent_handoff' &&
        t.data?.['toAgent'] === AGENT_NAMES.audit &&
        t.data?.['kind'] === 'log_audit' &&
        t.data?.['outcome'] === 'blocked'
    );
    check(
      failures,
      !!handoffToAudit,
      'unauth: orchestrator must hand off to AuditLedgerAgent with outcome=blocked'
    );

    const handoffToPolicy = traces1.find(
      (t) =>
        t.kind === 'agent_handoff' &&
        t.data?.['toAgent'] === AGENT_NAMES.policy &&
        t.data?.['kind'] === 'validate_action'
    );
    check(failures, !!handoffToPolicy, 'unauth: orchestrator must hand off to ActionPolicyAgent first');

    // 4 sub-assertions roll into one "test 1 passed" tally; count individually.
    if (blocked === null) passed++;
    if (ledger.length === 0) passed++;
    runs['unauth'] = {
      traces: traces1,
      signals: { blockedIsNull: blocked === null, ledgerLen: ledger.length },
    };
  } finally {
    unsub1();
  }

  // ---- Test 2: approved attempt is logged (dry-run success path) ----
  await clearLedger();
  const traces2: AgentTraceEvent[] = [];
  const unsub2 = subscribeTrace((e) => traces2.push(e));
  try {
    const ctx = await orch.buildContext('turn-approve');
    const action = await orch.proposeAndGate(unsubscribeAction(), ctx);
    check(failures, action !== null, 'approved: valid unsubscribe must pass policy');
    if (!action) throw new Error('approved path: action was null');

    const approval: ApprovalRecord = {
      proposedActionId: action.id,
      status: 'approved',
      approvedBy: 'user',
      approvedAt: new Date().toISOString(),
    };
    const result = await orch.runActionExecutor({ action, approval, sourceTabId: undefined, ctx });
    await orch.runAuditLedgerAgent(
      {
        proposedActionId: action.id,
        outcome: result.ok ? 'executed' : 'failed',
        detail: result.error,
      },
      ctx
    );

    const ledger = await getLedger();
    const entry = ledger.find((e) => e.proposed.id === action.id);
    check(failures, !!entry, 'approved: ledger must contain the proposed action');
    check(failures, !!entry?.executed, 'approved: ledger entry must record an ExecutedAction');

    const auditHandoff = traces2.find(
      (t) =>
        t.kind === 'agent_handoff' &&
        t.data?.['toAgent'] === AGENT_NAMES.audit &&
        t.data?.['kind'] === 'log_audit' &&
        t.data?.['outcome'] === 'executed'
    );
    check(failures, !!auditHandoff, 'approved: AuditLedgerAgent handoff with outcome=executed must be emitted');

    if (entry && entry.executed) passed++;
    if (auditHandoff) passed++;
    runs['approved'] = {
      traces: traces2,
      signals: { hasExecutedEntry: !!(entry && entry.executed) },
    };
  } finally {
    unsub2();
  }

  // ---- Test 3: approved-but-failed attempt is still logged ----
  // Simulate a failure by bypassing the unsub agent and calling the audit
  // agent directly with outcome='failed' (mirrors the real catch path). The
  // contract is "approved attempts are logged regardless of outcome".
  await clearLedger();
  const traces3: AgentTraceEvent[] = [];
  const unsub3 = subscribeTrace((e) => traces3.push(e));
  try {
    const ctx = await orch.buildContext('turn-fail');
    const action = await orch.proposeAndGate(unsubscribeAction(), ctx);
    if (!action) throw new Error('fail path: action was null');
    await orch.runAuditLedgerAgent(
      { proposedActionId: action.id, outcome: 'failed', detail: 'simulated DOM error' },
      ctx
    );
    const ledger = await getLedger();
    const entry = ledger.find((e) => e.proposed.id === action.id);
    check(failures, !!entry?.executed, 'failure: ledger must contain an ExecutedAction with ok=false');
    check(
      failures,
      entry?.executed?.result?.ok === false,
      'failure: ExecutedAction.result.ok must be false'
    );
    const failHandoff = traces3.find(
      (t) =>
        t.kind === 'agent_handoff' &&
        t.data?.['toAgent'] === AGENT_NAMES.audit &&
        t.data?.['outcome'] === 'failed'
    );
    check(failures, !!failHandoff, 'failure: AuditLedgerAgent handoff with outcome=failed must be emitted');
    if (entry?.executed?.result?.ok === false && failHandoff) passed++;
    runs['failed'] = {
      traces: traces3,
      signals: { executedOkFalse: entry?.executed?.result?.ok === false },
    };
  } finally {
    unsub3();
  }

  // ---- Test 4: MemoryAgent runs and is traced as a handoff ----
  await clearLedger();
  const traces4: AgentTraceEvent[] = [];
  const unsub4 = subscribeTrace((e) => traces4.push(e));
  try {
    const ctx = await orch.buildContext('turn-mem');
    const memRun = await orch.runMemoryAgent(ctx);
    check(failures, memRun.ok, 'memory: MemoryAgent run must succeed');
    const memHandoff = traces4.find(
      (t) =>
        t.kind === 'agent_handoff' &&
        t.data?.['toAgent'] === AGENT_NAMES.memory &&
        t.data?.['kind'] === 'recall_memory'
    );
    check(failures, !!memHandoff, 'memory: recall_memory handoff must be emitted');
    if (memRun.ok && memHandoff) passed++;
    runs['memory'] = { traces: traces4, signals: { memOk: memRun.ok } };
  } finally {
    unsub4();
  }

  // Mirror the contract as a versioned Weave Evaluation (no-op without
  // WANDB_API_KEY). The model replays each scenario's captured run (see the note
  // on sequential global state above); the scorers re-express the inline
  // subscribeTrace assertions — "the expected handoff occurred" and "the outcome
  // is correct" — by inspecting the REAL captured trace events per scenario.
  interface HandoffRow extends Record<string, unknown> {
    id: string;
    scenario: string;
  }
  type RunOut = { traces: AgentTraceEvent[]; signals: Record<string, unknown> };
  await logWeaveEvaluation<HandoffRow, RunOut>({
    datasetId: 'email-handoffs',
    evaluationId: 'multi-agent-handoffs',
    modelName: 'orchestratorContract',
    rows: [
      { id: 'unauth', scenario: 'unauth' },
      { id: 'approved', scenario: 'approved' },
      { id: 'failed', scenario: 'failed' },
      { id: 'memory', scenario: 'memory' },
    ],
    model: (row) => runs[row.scenario] ?? { traces: [], signals: {} },
    scorers: {
      // The handoff each scenario's contract requires actually occurred.
      expected_handoff_present: (row, out) => {
        const t = out.traces;
        switch (row.scenario) {
          case 'unauth':
            return (
              hasHandoff(t, AGENT_NAMES.policy, 'validate_action') &&
              hasHandoff(t, AGENT_NAMES.audit, 'log_audit', 'blocked')
            );
          case 'approved':
            return hasHandoff(t, AGENT_NAMES.audit, 'log_audit', 'executed');
          case 'failed':
            return t.some(
              (e) =>
                e.kind === 'agent_handoff' &&
                e.data?.['toAgent'] === AGENT_NAMES.audit &&
                e.data?.['outcome'] === 'failed'
            );
          case 'memory':
            return hasHandoff(t, AGENT_NAMES.memory, 'recall_memory');
          default:
            return false;
        }
      },
      // The scenario's enforced outcome matches the contract.
      outcome_correct: (row, out) => {
        const s = out.signals;
        switch (row.scenario) {
          case 'unauth':
            return s['blockedIsNull'] === true && s['ledgerLen'] === 0;
          case 'approved':
            return s['hasExecutedEntry'] === true;
          case 'failed':
            return s['executedOkFalse'] === true;
          case 'memory':
            return s['memOk'] === true;
          default:
            return false;
        }
      },
    },
  });

  return { passed, total, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHandoffsEval()
    .then((r) => {
      console.log(`Handoffs eval: ${r.passed}/${r.total}`);
      r.failures.forEach((f) => console.log('  ✗', f));
      process.exit(r.passed === r.total ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
