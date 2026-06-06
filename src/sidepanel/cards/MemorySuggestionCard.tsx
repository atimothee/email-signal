import React from 'react';
import type { MemorySuggestion } from '@schemas/index';

interface Props {
  suggestion: MemorySuggestion;
  onApprove: () => void;
  onReject: () => void;
}

export function MemorySuggestionCard({ suggestion, onApprove, onReject }: Props): JSX.Element {
  return (
    <article className="card" style={{ borderColor: 'var(--accent-2)' }}>
      <h3>EmailSignal wants to remember…</h3>
      <p style={{ fontSize: 13 }}>{suggestion.suggestion}</p>
      <div className="rationale">{suggestion.rationale}</div>
      <div className="meta">
        kind: {suggestion.proposedRecord.kind} · confidence{' '}
        {(suggestion.proposedRecord.confidence * 100).toFixed(0)}%
      </div>
      <div className="actions">
        <button className="primary" onClick={onApprove}>Save to memory</button>
        <button className="danger" onClick={onReject}>Discard</button>
      </div>
    </article>
  );
}
