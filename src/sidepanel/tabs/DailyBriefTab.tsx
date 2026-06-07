import React, { useEffect, useState } from 'react';
import { usePanelStore } from '../state/store';
import { ApprovalActionCard } from '../cards/ApprovalActionCard';
import { MemorySuggestionCard } from '../cards/MemorySuggestionCard';
import { DecisionCard } from '../cards/DecisionCard';
import { BatchActionReviewPanel } from '../cards/BatchActionReviewPanel';
import { EmptyState, Skeleton, ErrorState } from '../cards/primitives';
import { send, openGmailTab } from '../state/bridge';
import type { Decision, DecisionTheme, ProposedAction } from '@schemas/index';

const THEME_LABEL: Record<DecisionTheme, string> = {
  money: 'Money',
  reply: 'Replies',
  schedule: 'Scheduling',
  job: 'Job & career',
  travel: 'Travel',
  admin: 'Admin',
  security: 'Security',
  other: 'FYI',
};

/**
 * Arrange decisions so a theme that has ≥3 items reads as a cluster (contiguous,
 * with a sub-label), while sparse themes stay a flat ranked list. Matches the
 * "no one-item theme clusters" rule in design-guidelines.md.
 */
function arrange(decisions: Decision[]): Array<{ header?: string; decision: Decision }> {
  const counts = decisions.reduce<Record<string, number>>((acc, d) => {
    acc[d.theme] = (acc[d.theme] ?? 0) + 1;
    return acc;
  }, {});
  const clustered = decisions.filter((d) => (counts[d.theme] ?? 0) >= 3);
  const flat = decisions.filter((d) => (counts[d.theme] ?? 0) < 3);

  const out: Array<{ header?: string; decision: Decision }> = [];
  let lastTheme: string | null = null;
  // Stable group order: by first appearance in the ranked list.
  const order: DecisionTheme[] = [];
  for (const d of clustered) if (!order.includes(d.theme)) order.push(d.theme);
  for (const theme of order) {
    for (const d of clustered.filter((x) => x.theme === theme)) {
      out.push({ header: d.theme !== lastTheme ? THEME_LABEL[theme] : undefined, decision: d });
      lastTheme = d.theme;
    }
  }
  for (const d of flat) out.push({ decision: d });
  return out;
}

interface SectionHeadingProps {
  label: string;
  count?: number;
  tone?: 'accent' | 'warn';
  action?: { label: string; onClick: () => void };
}

function SectionHeading({ label, count, tone = 'accent', action }: SectionHeadingProps): JSX.Element {
  return (
    <div className="section-label">
      <span>{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span key={count} className={`count-badge ${tone === 'warn' ? 'warn' : ''}`}>{count}</span>
      )}
      {action && (
        <button className="section-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function patternKeyFor(a: ProposedAction): string {
  return (
    (a.params['senderDomain'] as string | undefined) ??
    (a.params['domain'] as string | undefined) ??
    (a.emailId ? `${a.type}:email` : a.type)
  );
}

function isBatchable(a: ProposedAction): boolean {
  return (
    (a.batchable ?? false) ||
    ((a.type === 'mark_read' || a.type === 'archive') &&
      a.reversible &&
      (a.risk === 'none' || a.risk === 'low'))
  );
}

export function DailyBriefTab(): JSX.Element {
  const decisions = usePanelStore((s) => s.decisions);
  const daySummary = usePanelStore((s) => s.daySummary);
  const removeDecision = usePanelStore((s) => s.removeDecision);
  const restoreDecision = usePanelStore((s) => s.restoreDecision);
  const account = usePanelStore((s) => s.account);
  const scanStatus = usePanelStore((s) => s.scanStatus);
  const scanProgress = usePanelStore((s) => s.scanProgress);
  const pending = usePanelStore((s) =>
    Object.values(s.proposedActions).filter((a) => a.approvalStatus === 'pending')
  );
  const memorySuggestions = usePanelStore((s) => s.memorySuggestions);
  const lastError = usePanelStore((s) => s.lastError);
  const dismissMemorySuggestion = usePanelStore((s) => s.dismissMemorySuggestion);
  const removeProposedAction = usePanelStore((s) => s.removeProposedAction);

  const [batchOpen, setBatchOpen] = useState(false);
  const [undo, setUndo] = useState<{ decision: Decision; label: string } | null>(null);
  const [demotedCollapsed, setDemotedCollapsed] = useState(true);

  // Time may only ever reorder/demote, never hide: active decisions surface on
  // top; demoted ones sink one tap away into the quiet "likely past" group.
  const active = decisions.filter((d) => !d.demoted);
  const demoted = decisions.filter((d) => d.demoted);

  // Auto-dismiss the undo snackbar after a few seconds.
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(t);
  }, [undo]);

  const disposition = (decision: Decision, action: 'handled' | 'snooze') => {
    send({
      kind: 'panel/decision_action',
      action,
      decisionId: decision.id,
      emailIds: decision.emailIds,
      untilMs: action === 'snooze' ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
    });
    removeDecision(decision.id);
    setUndo({ decision, label: action === 'handled' ? 'Marked handled' : 'Snoozed for a day' });
  };

  const correctDecision = (decision: Decision, text: string) => {
    send({
      kind: 'panel/correct_finding',
      findingId: decision.id,
      surface: 'priority',
      correction: text,
    });
  };

  const undoDisposition = () => {
    if (!undo) return;
    restoreDecision(undo.decision);
    send({
      kind: 'panel/decision_action',
      action: 'restore',
      decisionId: undo.decision.id,
      emailIds: undo.decision.emailIds,
    });
    setUndo(null);
  };

  const batchEligible = pending.filter(isBatchable);
  const scanning = scanStatus === 'reading' || scanStatus === 'thinking';
  const hasContent =
    decisions.length > 0 || pending.length > 0 || memorySuggestions.length > 0;

  // Never scanned yet, nothing to show. A single primary action — and we don't
  // tell the user to "open Gmail" when we can already see their account (#11).
  if (scanStatus === 'idle' && !hasContent) {
    if (account) {
      return (
        <EmptyState
          title="Scan your inbox"
          body="I'll read your last few hundred emails and surface only what genuinely needs a decision — nothing else."
          action={{ label: 'Scan inbox', onClick: () => send({ kind: 'panel/request_scan' }) }}
          hint="Nothing happens without your approval — you'll see every action here first."
        />
      );
    }
    return (
      <EmptyState
        title="Open Gmail to get started"
        body="Email Signal reads the Gmail tab you're signed into. Open Gmail, then scan — I'll surface only what needs you."
        action={{ label: 'Open Gmail', onClick: openGmailTab }}
        hint="Once Gmail is open, hit Scan and I'll read your last few hundred emails."
      />
    );
  }

  // Actively working with nothing to show yet — honest progress, not a dead button.
  if (scanning && !hasContent) {
    const reading = scanStatus === 'reading';
    return (
      <div>
        <div className="scan-status">
          <span className="scan-spinner" />
          <div>
            <div className="scan-status-title">
              {reading ? 'Reading your inbox…' : 'Figuring out what matters…'}
            </div>
            <div className="faint">
              {reading
                ? `Loaded ${scanProgress.loaded}${scanProgress.target ? ` of ~${scanProgress.target}` : ''} emails`
                : 'Synthesizing your decisions'}
            </div>
          </div>
        </div>
        <Skeleton card lines={2} />
        <Skeleton card lines={2} />
      </div>
    );
  }

  // Sidecar failed — the AI is required, so surface it (no silent fallback).
  if (scanStatus === 'error' && decisions.length === 0) {
    return (
      <div>
        <ErrorState message={lastError ?? 'The Email Signal sidecar is unavailable.'} />
        <EmptyState
          title="Can't reach the sidecar"
          body="All intelligence runs in the local Node sidecar. Start it with “npm run server”, then scan again."
          action={{ label: 'Try again', onClick: () => send({ kind: 'panel/request_scan' }) }}
          hint="Set the sidecar URL and your OpenAI key in Settings."
        />
      </div>
    );
  }

  // Scanned, but genuinely nothing pressing — calm, never padded.
  if (!scanning && decisions.length === 0 && pending.length === 0 && memorySuggestions.length === 0) {
    return (
      <EmptyState
        title="Nothing pressing today"
        body="I read your inbox and nothing needs a decision right now. Noise is sorted under Cleanup."
        action={{ label: 'Scan again', onClick: () => send({ kind: 'panel/request_scan' }) }}
        hint="I only surface things that genuinely need you — no busywork."
      />
    );
  }

  return (
    <div>
      {undo && (
        <div className="undo-bar" role="status">
          <span>{undo.label}</span>
          <button className="ghost" onClick={undoDisposition}>Undo</button>
        </div>
      )}

      {daySummary && decisions.length > 0 && (
        <p className="day-summary">{daySummary}</p>
      )}

      {batchOpen && (
        <BatchActionReviewPanel
          actions={pending}
          onCancel={() => setBatchOpen(false)}
          onConfirm={(ids) => {
            send({
              kind: 'panel/batch_approve',
              proposedActionIds: ids,
              confirmedAt: new Date().toISOString(),
            });
            ids.forEach(removeProposedAction);
            setBatchOpen(false);
          }}
        />
      )}

      {pending.length > 0 && !batchOpen && (
        <>
          <SectionHeading
            label="Decide now"
            count={pending.length}
            tone="warn"
            action={
              batchEligible.length >= 2
                ? { label: `Batch ${batchEligible.length}`, onClick: () => setBatchOpen(true) }
                : undefined
            }
          />
          {pending.map((a) => (
            <ApprovalActionCard
              key={a.id}
              action={a}
              onApprove={() => {
                send({
                  kind: 'panel/approve_action',
                  approval: {
                    proposedActionId: a.id,
                    status: 'approved',
                    approvedAt: new Date().toISOString(),
                    approvedBy: 'user',
                  },
                });
                removeProposedAction(a.id);
              }}
              onReject={() => {
                send({ kind: 'panel/reject_action', proposedActionId: a.id });
                removeProposedAction(a.id);
              }}
              onAlwaysSuggest={() =>
                send({
                  kind: 'panel/always_suggest',
                  proposedActionId: a.id,
                  patternKey: patternKeyFor(a),
                })
              }
              onNeverSuggest={() => {
                send({
                  kind: 'panel/never_suggest',
                  proposedActionId: a.id,
                  patternKey: patternKeyFor(a),
                });
                removeProposedAction(a.id);
              }}
              onHighlight={() => {
                const sel =
                  (a.params['rowSelector'] as string | undefined) ??
                  (a.params['selector'] as string | undefined);
                if (sel) send({ kind: 'panel/highlight', selector: sel });
              }}
              onCorrect={(text) =>
                send({
                  kind: 'panel/correct_action',
                  proposedActionId: a.id,
                  correction: text,
                })
              }
            />
          ))}
        </>
      )}

      {memorySuggestions.length > 0 && (
        <>
          <SectionHeading label="Should I remember this?" count={memorySuggestions.length} />
          {memorySuggestions.map((s) => (
            <MemorySuggestionCard
              key={s.id}
              suggestion={s}
              onApprove={() => {
                send({
                  kind: 'panel/save_preference',
                  preference: {
                    id: s.proposedRecord.id,
                    kind: 'custom',
                    key: s.proposedRecord.summary.slice(0, 40),
                    value: s.suggestion,
                    source: 'agent_suggested_then_approved',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  },
                });
                dismissMemorySuggestion(s.id);
              }}
              onReject={() => dismissMemorySuggestion(s.id)}
              onCorrect={(text) =>
                send({
                  kind: 'panel/correct_finding',
                  findingId: s.id,
                  surface: 'memory',
                  correction: text,
                })
              }
            />
          ))}
        </>
      )}

      {active.length > 0 && (
        <>
          <SectionHeading label="What needs you today" count={active.length} />
          {arrange(active).map(({ header, decision }) => (
            <React.Fragment key={decision.id}>
              {header && <div className="theme-subhead">{header}</div>}
              <DecisionCard
                decision={decision}
                onHighlight={(selector) => send({ kind: 'panel/highlight', selector })}
                onHandled={() => disposition(decision, 'handled')}
                onSnooze={() => disposition(decision, 'snooze')}
                onCorrect={(text) => correctDecision(decision, text)}
              />
            </React.Fragment>
          ))}
        </>
      )}

      {demoted.length > 0 && (
        <>
          <SectionHeading
            label="Likely past — handled?"
            count={demoted.length}
            action={{
              label: demotedCollapsed ? 'Show' : 'Hide',
              onClick: () => setDemotedCollapsed((c) => !c),
            }}
          />
          {!demotedCollapsed &&
            demoted.map((decision) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                onHighlight={(selector) => send({ kind: 'panel/highlight', selector })}
                onHandled={() => disposition(decision, 'handled')}
                onSnooze={() => disposition(decision, 'snooze')}
                onCorrect={(text) => correctDecision(decision, text)}
              />
            ))}
        </>
      )}
    </div>
  );
}
