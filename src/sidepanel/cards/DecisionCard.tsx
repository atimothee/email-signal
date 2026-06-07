import React, { useState } from 'react';
import type { Decision, DecisionTheme, DecisionUrgency } from '@schemas/index';
import { CorrectThis } from './primitives';

interface Props {
  decision: Decision;
  /**
   * Do the primary action: open the best actionable link, else the Gmail thread,
   * else highlight the row — with visible fallback. When provided, this replaces
   * the legacy onHighlight-only behavior.
   */
  onPrimary?: (decision: Decision) => void;
  /** Legacy: highlight the underlying email(s) in the Gmail tab (fallback). */
  onHighlight?: (selector: string) => void;
  /** Mark this decision dealt with — it leaves Today and won't resurface. */
  onHandled?: () => void;
  /** Snooze this decision out of Today until later. */
  onSnooze?: () => void;
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
export function DecisionCard({
  decision,
  onPrimary,
  onHighlight,
  onHandled,
  onSnooze,
  onCorrect,
}: Props): JSX.Element {
  const actionLabel = decision.suggestedAction?.label ?? 'Open in Gmail';
  // Actionable if we can open a link, the thread, or (legacy) highlight a row.
  const canAct = onPrimary
    ? !!(decision.actionUrl || decision.threadLocator || decision.rowSelector)
    : !!decision.rowSelector && !!onHighlight;
  const runPrimary = () => {
    if (onPrimary) return onPrimary(decision);
    if (decision.rowSelector) onHighlight?.(decision.rowSelector);
  };
  const [leaving, setLeaving] = useState(false);

  // Tactile slide-out before the decision is removed (matches ApprovalActionCard).
  const dispatch = (cb?: () => void) => {
    if (!cb) return;
    setLeaving(true);
    window.setTimeout(cb, 280);
  };

  const overdue = isOverdue(decision.dueAt);

  return (
    <article
      className={`card decision t-${decision.theme} ${decision.demoted ? 'demoted' : ''} ${leaving ? 'leaving' : ''}`}
    >
      <div className="decision-head">
        <span className="theme-chip">{THEME_LABEL[decision.theme]}</span>
        {decision.urgency !== 'normal' && decision.urgency !== 'low' && (
          <span className={`urgency-flag u-${decision.urgency}`}>
            {URGENCY_LABEL[decision.urgency]}
          </span>
        )}
        {decision.dueAt &&
          (overdue ? (
            <span className="pill due overdue">overdue · {formatDue(decision.dueAt)}</span>
          ) : (
            <span className="pill due">due {formatDue(decision.dueAt)}</span>
          ))}
      </div>

      <h3 className="decision-title">{decision.title}</h3>
      <p className="decision-why">{decision.why}</p>
      {decision.demoted && decision.demotedReason && (
        <p className="demoted-reason">{decision.demotedReason}</p>
      )}

      <div className="decision-foot">
        <span className="decision-senders" title={decision.senders.join(', ')}>
          {sendersLabel(decision)}
        </span>
        {!decision.demoted && decision.receivedAt && (
          <span className="decision-age">{formatRelativeAge(decision.receivedAt)}</span>
        )}
      </div>

      <div className="actions">
        <button
          className="primary"
          onClick={runPrimary}
          disabled={!canAct}
          title={
            canAct
              ? decision.actionUrl
                ? 'Open the link from this email'
                : 'Jump to this email in Gmail'
              : undefined
          }
        >
          {actionLabel}
        </button>
        {onHandled && (
          <button className="ghost" onClick={() => dispatch(onHandled)} title="I've dealt with this — remove it from Today">
            Mark handled
          </button>
        )}
        {/* Snooze and "Not for me" are inline so they're never clipped by the
            scroll container. We accept a slightly busier action row in exchange
            for reliable visibility on a narrow side panel. */}
        {onSnooze && (
          <button className="ghost" onClick={() => dispatch(onSnooze)} title="Snooze this out of Today">
            Snooze
          </button>
        )}
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

/** True when dueAt parses to a time strictly before now. Unparseable -> false. */
function isOverdue(value: string | null | undefined): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

/**
 * Quiet, human relative age of an email: "Just now", "5m", "3h",
 * "2 days ago", "3 weeks ago", "4 months ago". Recency is a faint cue, never a
 * relevance signal — this is display only. Unparseable -> empty string.
 */
export function formatRelativeAge(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return 'Just now';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;

  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}
