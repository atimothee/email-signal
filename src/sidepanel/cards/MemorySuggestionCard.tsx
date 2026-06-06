import React, { useState } from 'react';
import type { MemorySuggestion } from '@schemas/index';

interface Props {
  suggestion: MemorySuggestion;
  onApprove: () => void;
  onReject: () => void;
}

export function MemorySuggestionCard({ suggestion, onApprove, onReject }: Props): JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const dispatch = (cb: () => void) => {
    setLeaving(true);
    window.setTimeout(cb, 280);
  };
  return (
    <article className={`card ${leaving ? 'leaving' : ''}`}>
      <h3>Remember this?</h3>
      <p style={{ fontSize: 13.5, margin: '4px 0 0' }}>{suggestion.suggestion}</p>
      <div className="rationale">{suggestion.rationale}</div>
      <div className="meta" style={{ marginTop: 6 }}>
        {suggestion.proposedRecord.kind} · {(suggestion.proposedRecord.confidence * 100).toFixed(0)}% confidence
      </div>
      <div className="actions">
        <button className="primary" onClick={() => dispatch(onApprove)}>Save to memory</button>
        <button className="danger" onClick={() => dispatch(onReject)}>Discard</button>
      </div>
    </article>
  );
}
