import React, { useState } from 'react';
import { usePanelStore } from '../state/store';
import { DailyBriefSection } from '../cards/DailyBriefSection';
import { ApprovalActionCard } from '../cards/ApprovalActionCard';
import { MemorySuggestionCard } from '../cards/MemorySuggestionCard';
import { EmailPriorityCard } from '../cards/EmailPriorityCard';
import { BatchActionReviewPanel } from '../cards/BatchActionReviewPanel';
import { EmptyState } from '../cards/primitives';
import { send } from '../state/bridge';
import type { ProposedAction } from '@schemas/index';

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
  const brief = usePanelStore((s) => s.brief);
  const priorities = usePanelStore((s) => s.priorities);
  const pending = usePanelStore((s) =>
    Object.values(s.proposedActions).filter((a) => a.approvalStatus === 'pending')
  );
  const memorySuggestions = usePanelStore((s) => s.memorySuggestions);
  const dismissMemorySuggestion = usePanelStore((s) => s.dismissMemorySuggestion);
  const removeProposedAction = usePanelStore((s) => s.removeProposedAction);

  const [batchOpen, setBatchOpen] = useState(false);

  const batchEligible = pending.filter(isBatchable);
  const isEmpty =
    !brief && priorities.length === 0 && pending.length === 0 && memorySuggestions.length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        title="Ready when you are"
        body="Open Gmail in another tab, then scan your inbox."
        action={{ label: 'Scan inbox', onClick: () => send({ kind: 'panel/request_scan' }) }}
        hint="Nothing happens without your approval — you'll see every action here first."
      />
    );
  }

  return (
    <div>
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
                if (sel) send({ kind: 'bg/highlight', selector: sel });
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

      {brief ? (
        <>
          <SectionHeading label="Today's brief" />
          <div className="brief-headline">{brief.headline}</div>
          <div className="faint" style={{ marginBottom: 8 }}>
            Generated {new Date(brief.generatedAt).toLocaleString()}
          </div>
          {brief.sections.map((s) => (
            <DailyBriefSection
              key={s.kind}
              section={s}
              onCorrectFinding={(id, text) =>
                send({
                  kind: 'panel/correct_finding',
                  findingId: id,
                  surface: 'brief',
                  correction: text,
                })
              }
              onCorrectGroup={(domain, text) =>
                send({
                  kind: 'panel/correct_finding',
                  findingId: domain,
                  surface: 'clutter',
                  correction: text,
                })
              }
            />
          ))}
        </>
      ) : priorities.length > 0 ? (
        <>
          <SectionHeading label="Priorities" count={priorities.length} />
          {priorities.map((p) => (
            <EmailPriorityCard
              key={p.emailId}
              finding={p}
              onCorrect={(text) =>
                send({
                  kind: 'panel/correct_finding',
                  findingId: p.emailId,
                  surface: 'priority',
                  correction: text,
                })
              }
            />
          ))}
        </>
      ) : null}
    </div>
  );
}
