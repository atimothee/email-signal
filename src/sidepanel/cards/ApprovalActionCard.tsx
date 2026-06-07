import React, { useState } from 'react';
import type { ProposedAction } from '@schemas/index';
import {
  ConfidenceBadge,
  CorrectThis,
  ReversibilityBadge,
  RiskBadge,
  WhyShown,
} from './primitives';

interface Props {
  action: ProposedAction;
  onApprove: () => void;
  onReject: () => void;
  /** Persist suggestion pattern but never auto-execute. */
  onAlwaysSuggest?: () => void;
  /** Suppress this suggestion pattern from now on. */
  onNeverSuggest?: () => void;
  onHighlight?: () => void;
  onCorrect?: (text: string) => void;
}

/**
 * Approval card with the four-action approval model.
 *
 * Approve once / Reject / Always suggest (never auto-act) / Never suggest again.
 *
 * Critical: NO "approve all forever" affordance. Each execution requires a
 * deliberate per-card approval. "Always suggest" persists the *pattern* of
 * surfacing the suggestion, never the automatic execution.
 */
export function ApprovalActionCard({
  action,
  onApprove,
  onReject,
  onAlwaysSuggest,
  onNeverSuggest,
  onHighlight,
  onCorrect,
}: Props): JSX.Element {
  const [leaving, setLeaving] = useState(false);

  const dispatch = (cb: () => void) => {
    setLeaving(true);
    window.setTimeout(cb, 280);
  };

  const isUnsubscribe = action.type === 'click_unsubscribe';
  const effect = action.effectPreview ?? defaultEffect(action);
  const why = action.whyShown ?? `Suggested by ${action.proposedBy}.`;

  return (
    <article className={`card accent ${leaving ? 'leaving' : ''}`} aria-live="polite">
      <h3>{action.title}</h3>

      <div className="badge-row">
        <RiskBadge risk={action.risk} />
        <ReversibilityBadge reversible={action.reversible} />
        {typeof action.confidence === 'number' && (
          <ConfidenceBadge value={action.confidence} />
        )}
      </div>

      <p style={{ fontSize: 12.5, margin: '10px 0 0', color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {action.rationale}
      </p>

      <div className="effect-preview">
        <div className="label">If you approve</div>
        <div>{effect}</div>
      </div>

      {isUnsubscribe && (
        <p className="subtle" style={{ marginTop: 8 }}>
          You'll confirm the unsubscribe on the sender's page — we never click it for you.
        </p>
      )}

      <WhyShown reason={why} />


      <div className="approval-actions">
        <button className="primary" onClick={() => dispatch(onApprove)}>
          Approve once
        </button>
        <button className="danger" onClick={() => dispatch(onReject)}>
          Reject
        </button>
        {onHighlight && (
          <button className="ghost" onClick={onHighlight}>
            Show in Gmail
          </button>
        )}
        <div className="secondary-row">
          {onAlwaysSuggest && (
            <button
              title="Keep suggesting this — I'll still approve each one."
              onClick={onAlwaysSuggest}
            >
              Keep suggesting
            </button>
          )}
          {onNeverSuggest && (
            <button
              className="danger-soft"
              title="Stop suggesting this kind of thing."
              onClick={onNeverSuggest}
            >
              Stop suggesting
            </button>
          )}
        </div>
      </div>

      {onCorrect && (
        <div style={{ marginTop: 10 }}>
          <CorrectThis onSubmit={onCorrect} />
        </div>
      )}
    </article>
  );
}

function defaultEffect(action: ProposedAction): string {
  switch (action.type) {
    case 'click_unsubscribe':
      return "Opens the sender's unsubscribe page in a new tab.";
    case 'mark_read':
      return 'Marks this as read. Undo from History.';
    case 'archive':
      return 'Archives this out of the inbox. Undo from History.';
    case 'apply_label':
      return `Adds the label "${action.params['labelName'] ?? 'Email Signal'}".`;
    case 'suggest_label':
      return 'Suggests a label — nothing is applied until you pick.';
    case 'remember_preference':
      return 'Saves a preference. Editable in Settings.';
    case 'highlight_element':
      return 'Highlights this in Gmail.';
    case 'scroll_to_element':
      return 'Scrolls Gmail to this email.';
    case 'open_email':
      return 'Opens this email in Gmail.';
    case 'find_unsubscribe_link':
      return 'Finds the unsubscribe link without clicking it.';
    default:
      return 'Carries out the action above.';
  }
}
