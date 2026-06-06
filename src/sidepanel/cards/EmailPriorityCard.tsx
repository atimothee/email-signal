import React from 'react';
import type { PriorityFinding } from '@schemas/index';

interface Props {
  finding: PriorityFinding;
  onHighlight?: () => void;
  onPropose?: () => void;
}

export function EmailPriorityCard({ finding, onHighlight, onPropose }: Props): JSX.Element {
  const urgencyClass =
    finding.urgency === 'critical'
      ? 'critical'
      : finding.urgency === 'high'
        ? 'high'
        : finding.urgency === 'low'
          ? ''
          : 'warn';
  return (
    <article className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>{finding.subject || '(no subject)'}</h3>
        <span className={`pill ${urgencyClass}`}>{finding.urgency}</span>
      </div>
      <div className="meta">
        {finding.senderDisplay} · <span className="pill">{finding.category}</span>
        {finding.dueAt && <> · due {new Date(finding.dueAt).toLocaleDateString()}</>}
      </div>
      <p style={{ fontSize: 12, margin: '8px 0 0' }}>{finding.excerpt}</p>
      <div className="rationale">{finding.rationale}</div>
      {finding.ask && <div className="rationale">Ask: <em>{finding.ask}</em></div>}
      <div className="actions">
        {onHighlight && <button onClick={onHighlight}>Highlight in Gmail</button>}
        {onPropose && <button onClick={onPropose} className="ghost">Propose reply</button>}
      </div>
    </article>
  );
}
