import React from 'react';
import type { Decision, DecisionTheme, DecisionUrgency } from '@schemas/index';
import { CorrectThis } from './primitives';

interface Props {
  decision: Decision;
  /** Highlight the underlying email(s) in the Gmail tab. */
  onHighlight?: (selector: string) => void;
  onCorrect?: (text: string) => void;
}

const THEME_LABEL: Record<DecisionTheme, string> = {
  money: 'Money',
  reply: 'Reply',
  schedule: 'Schedule',
  job: 'Job',
  travel: 'Travel',
  admin: 'Admin',
  security: 'Security',
  other: 'FYI',
};

const URGENCY_LABEL: Record<DecisionUrgency, string> = {
  critical: 'Urgent',
  high: 'Soon',
  normal: '',
  low: '',
};

/**
 * One decision = one card. This is the synthesis surface: a verb-led title in
 * the user's voice, a one-line why, who it's from, and a single action. It
 * deliberately does NOT dump the email body — if the user wants the email, the
 * action takes them to it in Gmail.
 */
export function DecisionCard({ decision, onHighlight, onCorrect }: Props): JSX.Element {
  const actionLabel = decision.suggestedAction?.label ?? 'Open in Gmail';
  const canOpen = !!decision.rowSelector && !!onHighlight;

  return (
    <article className={`card decision t-${decision.theme}`}>
      <div className="decision-head">
        <span className="theme-chip">{THEME_LABEL[decision.theme]}</span>
        {decision.urgency !== 'normal' && decision.urgency !== 'low' && (
          <span className={`urgency-flag u-${decision.urgency}`}>
            {URGENCY_LABEL[decision.urgency]}
          </span>
        )}
        {decision.dueAt && <span className="pill due">due {formatDue(decision.dueAt)}</span>}
      </div>

      <h3 className="decision-title">{decision.title}</h3>
      <p className="decision-why">{decision.why}</p>

      <div className="decision-foot">
        <span className="decision-senders" title={decision.senders.join(', ')}>
          {sendersLabel(decision)}
        </span>
      </div>

      <div className="actions">
        <button
          className="primary"
          onClick={() => decision.rowSelector && onHighlight?.(decision.rowSelector)}
          disabled={!canOpen}
          title={canOpen ? 'Jump to this in Gmail' : undefined}
        >
          {actionLabel}
        </button>
        {onCorrect && <CorrectThis onSubmit={onCorrect} label="Not for me" />}
      </div>
    </article>
  );
}

function sendersLabel(d: Decision): string {
  const first = d.senders[0] ?? 'Unknown sender';
  const others = d.senders.length > 1 ? ` +${d.senders.length - 1}` : '';
  const emails = d.count > 1 ? ` · ${d.count} emails` : '';
  return `${first}${others}${emails}`;
}

function formatDue(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
