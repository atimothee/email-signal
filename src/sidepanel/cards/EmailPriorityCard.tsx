import React from 'react';
import type { PriorityFinding } from '@schemas/index';
import { ConfidenceBadge, CorrectThis, WhyShown } from './primitives';

interface Props {
  finding: PriorityFinding;
  onHighlight?: () => void;
  onPropose?: () => void;
  onCorrect?: (text: string) => void;
}

export function EmailPriorityCard({ finding, onHighlight, onPropose, onCorrect }: Props): JSX.Element {
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
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <h3 style={{ minWidth: 0, flex: 1 }}>{finding.subject || '(no subject)'}</h3>
        <span className={`pill ${urgencyClass}`}>{finding.urgency}</span>
      </div>
      <div className="meta">
        {finding.senderDisplay} · <span className="pill">{prettyCategory(finding.category)}</span>
        {finding.dueAt && <> · due {formatDue(finding.dueAt)}</>}
      </div>

      <div className="badge-row" style={{ marginTop: 6 }}>
        <ConfidenceBadge value={finding.confidence} />
        {finding.needsReply && <span className="pill warn">needs reply</span>}
      </div>

      <p style={{ fontSize: 12.5, margin: '10px 0 0', color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {finding.excerpt}
      </p>
      <div className="rationale"><strong>Why it matters:</strong> {finding.rationale}</div>
      {finding.ask && <div className="rationale">Ask: <em>{finding.ask}</em></div>}

      <WhyShown
        reason={`Classified as ${prettyCategory(finding.category)} with ${finding.urgency} urgency.`}
        evidence={finding.dueAt ? `Due date detected in the body.` : undefined}
      />

      <div className="actions">
        {onHighlight && <button onClick={onHighlight}>Highlight in Gmail</button>}
        {onPropose && (
          <button onClick={onPropose} className="ghost">
            Propose reply
          </button>
        )}
        {onCorrect && <CorrectThis onSubmit={onCorrect} label="Not quite right?" />}
      </div>
    </article>
  );
}

function prettyCategory(c: string): string {
  return c.replace(/_/g, ' ');
}

function formatDue(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}
