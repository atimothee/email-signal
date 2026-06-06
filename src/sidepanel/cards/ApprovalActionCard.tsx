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
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{action.title}</h3>
          <div className="meta">
            Proposed by <strong>{humanize(action.proposedBy)}</strong>
          </div>
        </div>
      </div>

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
          You will land on the sender's unsubscribe page and confirm there. EmailSignal
          never clicks the final unsubscribe button for you.
        </p>
      )}

      <WhyShown
        reason={why}
        evidence={action.emailId ? `Email reference: ${action.emailId}` : undefined}
      />

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
              title="Keep proposing suggestions like this — I still want to approve every time."
              onClick={onAlwaysSuggest}
            >
              Always suggest this (no auto-act)
            </button>
          )}
          {onNeverSuggest && (
            <button
              className="danger-soft"
              title="Never propose this kind of suggestion again."
              onClick={onNeverSuggest}
            >
              Never suggest this again
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

function humanize(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function defaultEffect(action: ProposedAction): string {
  switch (action.type) {
    case 'click_unsubscribe':
      return 'Open the sender\'s unsubscribe page in a new tab. You confirm there.';
    case 'mark_read':
      return 'Mark this message as read in Gmail. Reversible from the action history.';
    case 'archive':
      return 'Move this message out of the inbox into All Mail. Reversible.';
    case 'apply_label':
      return `Apply the label "${action.params['labelName'] ?? 'EmailSignal'}".`;
    case 'suggest_label':
      return 'Suggest a label only — nothing is applied until you choose.';
    case 'remember_preference':
      return 'Save this as a learned preference. Editable from Settings.';
    case 'highlight_element':
      return 'Highlight this in the Gmail tab so you can find it visually.';
    case 'scroll_to_element':
      return 'Scroll the Gmail tab to this email.';
    case 'open_email':
      return 'Open this email in Gmail.';
    case 'find_unsubscribe_link':
      return 'Locate the unsubscribe link without clicking it.';
    default:
      return 'Carry out the action shown above.';
  }
}
