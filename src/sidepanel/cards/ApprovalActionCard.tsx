import React from 'react';
import type { ProposedAction } from '@schemas/index';

interface Props {
  action: ProposedAction;
  onApprove: () => void;
  onReject: () => void;
  onHighlight?: () => void;
}

export function ApprovalActionCard({ action, onApprove, onReject, onHighlight }: Props): JSX.Element {
  const riskClass =
    action.risk === 'high' ? 'critical' : action.risk === 'medium' ? 'high' : 'warn';
  return (
    <article className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>{action.title}</h3>
        <span className={`pill ${riskClass}`}>{action.risk} risk</span>
      </div>
      <div className="meta">
        proposed by <strong>{action.proposedBy}</strong> · type {action.type}
        {' · '}
        {action.reversible ? 'reversible' : 'NOT reversible'}
      </div>
      <p style={{ fontSize: 12, margin: '8px 0 0' }}>{action.rationale}</p>
      {action.type === 'click_unsubscribe' && (
        <p className="subtle" style={{ marginTop: 6 }}>
          Will open <code>{String(action.params['unsubscribeHref']).slice(0, 60)}…</code> in a new tab.
          You can confirm the unsubscribe yourself on the destination page. We never enter
          credentials or submit forms.
        </p>
      )}
      <div className="actions">
        <button className="primary" onClick={onApprove}>
          Approve
        </button>
        <button className="danger" onClick={onReject}>
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
