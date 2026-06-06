import React from 'react';
import { usePanelStore } from '../state/store';
import { DailyBriefSection } from '../cards/DailyBriefSection';
import { ApprovalActionCard } from '../cards/ApprovalActionCard';
import { MemorySuggestionCard } from '../cards/MemorySuggestionCard';
import { EmailPriorityCard } from '../cards/EmailPriorityCard';
import { send } from '../state/bridge';

interface SectionHeadingProps {
  label: string;
  count?: number;
  tone?: 'accent' | 'warn';
}

function SectionHeading({ label, count, tone = 'accent' }: SectionHeadingProps): JSX.Element {
  return (
    <div className="section-label">
      <span>{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span key={count} className={`count-badge ${tone === 'warn' ? 'warn' : ''}`}>{count}</span>
      )}
    </div>
  );
}

export function DailyBriefTab(): JSX.Element {
  const brief = usePanelStore((s) => s.brief);
  const priorities = usePanelStore((s) => s.priorities);
  const pending = usePanelStore((s) =>
    Object.values(s.proposedActions).filter((a) => a.approvalStatus === 'pending')
  );
  const memorySuggestions = usePanelStore((s) => s.memorySuggestions);

  const isEmpty = !brief && priorities.length === 0 && pending.length === 0 && memorySuggestions.length === 0;

  if (isEmpty) {
    return (
      <div className="empty">
        <div className="empty-orb" />
        <div className="empty-title">Ready when you are</div>
        <div>Open Gmail in another tab, then scan your inbox.</div>
        <div style={{ marginTop: 16 }}>
          <button
            className="primary"
            onClick={() => send({ kind: 'panel/request_scan' })}
          >
            Scan inbox
          </button>
        </div>
        <div className="empty-hint">
          Nothing happens without your approval — you'll see every action here first.
        </div>
      </div>
    );
  }

  return (
    <div>
      {pending.length > 0 && (
        <>
          <SectionHeading label="Decide now" count={pending.length} tone="warn" />
          {pending.map((a) => (
            <ApprovalActionCard
              key={a.id}
              action={a}
              onApprove={() =>
                send({
                  kind: 'panel/approve_action',
                  approval: {
                    proposedActionId: a.id,
                    status: 'approved',
                    approvedAt: new Date().toISOString(),
                    approvedBy: 'user',
                  },
                })
              }
              onReject={() => send({ kind: 'panel/reject_action', proposedActionId: a.id })}
              onHighlight={() => {
                const sel =
                  (a.params['rowSelector'] as string | undefined) ??
                  (a.params['selector'] as string | undefined);
                if (sel) send({ kind: 'bg/highlight', selector: sel });
              }}
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
              onApprove={() => send({ kind: 'panel/save_preference', preference: {
                id: s.proposedRecord.id,
                kind: 'custom',
                key: s.proposedRecord.summary.slice(0, 40),
                value: s.suggestion,
                source: 'agent_suggested_then_approved',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }})}
              onReject={() => {
                /* drop locally — full impl: send to background to clear */
              }}
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
            <DailyBriefSection key={s.kind} section={s} />
          ))}
        </>
      ) : priorities.length > 0 ? (
        <>
          <SectionHeading label="Priorities" count={priorities.length} />
          {priorities.map((p) => (
            <EmailPriorityCard key={p.emailId} finding={p} />
          ))}
        </>
      ) : null}
    </div>
  );
}
