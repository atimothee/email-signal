import React, { useState } from 'react';
import type { MemorySuggestion } from '@schemas/index';
import { ConfidenceBadge, CorrectThis, WhyShown } from './primitives';

interface Props {
  suggestion: MemorySuggestion;
  onApprove: () => void;
  onReject: () => void;
  onCorrect?: (text: string) => void;
}

export function MemorySuggestionCard({
  suggestion,
  onApprove,
  onReject,
  onCorrect,
}: Props): JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const dispatch = (cb: () => void) => {
    setLeaving(true);
    window.setTimeout(cb, 280);
  };

  return (
    <article className={`card ${leaving ? 'leaving' : ''}`}>
      <h3>Remember this?</h3>
      <p style={{ fontSize: 13.5, margin: '4px 0 0' }}>{suggestion.suggestion}</p>

      <div className="badge-row" style={{ marginTop: 8 }}>
        <span className="pill">{suggestion.proposedRecord.kind.replace(/_/g, ' ')}</span>
        <ConfidenceBadge value={suggestion.proposedRecord.confidence} />
      </div>

      <div className="rationale">{suggestion.rationale}</div>

      <div className="effect-preview">
        <div className="label">If you save</div>
        <div>
          Stored in your local memory and used to tune future suggestions. Editable or
          removable from Settings → Memory at any time.
        </div>
      </div>

      <WhyShown reason="Pattern noticed across recent interactions." />

      <div className="actions">
        <button className="primary" onClick={() => dispatch(onApprove)}>
          Save to memory
        </button>
        <button className="danger" onClick={() => dispatch(onReject)}>
          Discard
        </button>
        {onCorrect && <CorrectThis onSubmit={onCorrect} label="That's not right" />}
      </div>
    </article>
  );
}
