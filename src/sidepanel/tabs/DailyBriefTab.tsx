import React from 'react';
import { usePanelStore } from '../state/store';
import { DailyBriefSection } from '../cards/DailyBriefSection';
import { ApprovalActionCard } from '../cards/ApprovalActionCard';
import { MemorySuggestionCard } from '../cards/MemorySuggestionCard';
import { EmailPriorityCard } from '../cards/EmailPriorityCard';
import { send } from '../state/bridge';

export function DailyBriefTab(): JSX.Element {
  const brief = usePanelStore((s) => s.brief);
  const priorities = usePanelStore((s) => s.priorities);
  const pending = usePanelStore((s) =>
    Object.values(s.proposedActions).filter((a) => a.approvalStatus === 'pending')
  );
  const memorySuggestions = usePanelStore((s) => s.memorySuggestions);

  return (
    <div>
      {pending.length > 0 && (
        <>
          <h2 style={{ fontSize: 13, margin: '0 0 8px' }}>Awaiting your approval</h2>
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
          <h2 style={{ fontSize: 13, margin: '14px 0 8px' }}>Memory suggestions</h2>
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
          <h1 style={{ fontSize: 16, margin: '14px 0 4px' }}>{brief.headline}</h1>
          <div className="subtle">
            Generated {new Date(brief.generatedAt).toLocaleString()}
          </div>
          {brief.sections.map((s) => (
            <DailyBriefSection key={s.kind} section={s} />
          ))}
        </>
      ) : (
        <>
          <div className="empty">
            No brief yet — open Gmail in another tab, then click <em>↻ Scan now</em>, then
            <button
              className="primary"
              style={{ marginLeft: 6 }}
              onClick={() => send({ kind: 'panel/request_brief' })}
            >
              Generate brief
            </button>
          </div>
          {priorities.length > 0 && (
            <>
              <h2 style={{ fontSize: 13, margin: '14px 0 8px' }}>Priority emails</h2>
              {priorities.map((p) => (
                <EmailPriorityCard key={p.emailId} finding={p} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
