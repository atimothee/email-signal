import React, { useState } from 'react';
import type { ProposedAction } from '@schemas/index';

interface Props {
  action: ProposedAction;
  onApprove: () => void;
  onReject: () => void;
  onHighlight?: () => void;
}

export function ApprovalActionCard({ action, onApprove, onReject, onHighlight }: Props): JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const riskClass =
    action.risk === 'high' ? 'critical' : action.risk === 'medium' ? 'high' : 'warn';

  const dispatch = (cb: () => void) => {
    setLeaving(true);
    window.setTimeout(cb, 280);
  };

  return (
    <article className={`card accent ${leaving ? 'leaving' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <h3>{action.title}</h3>
        <span className={`pill ${riskClass}`}>{action.risk} risk</span>
      </div>
      <div className="meta">
        {action.proposedBy} · {action.reversible ? 'reversible' : 'not reversible'}
      </div>
      <p style={{ fontSize: 12.5, margin: '8px 0 0', color: 'var(--text-dim)' }}>{action.rationale}</p>
      {action.type === 'click_unsubscribe' && (
        <p className="subtle" style={{ marginTop: 6 }}>
          Will open <code>{String(action.params['unsubscribeHref']).slice(0, 60)}…</code> in a new tab.
          You'll confirm the unsubscribe on the destination page.
        </p>
      )}
      <div className="actions">
        <button className="primary" onClick={() => dispatch(onApprove)}>
          Approve
        </button>
        <button className="danger" onClick={() => dispatch(onReject)}>
          Reject
        </button>
        {onHighlight && (
          <button className="ghost" onClick={onHighlight}>
            Show in Gmail
          </button>
        )}
      </div>
    </article>
  );
}
