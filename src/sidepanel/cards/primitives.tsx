import React, { useEffect, useRef, useState } from 'react';

/**
 * Shared UI primitives used across every generative-UI card:
 *   - Skeleton, EmptyState, ErrorState
 *   - ConfidenceBadge, RiskBadge, ReversibilityBadge
 *   - WhyShown disclosure
 *   - CorrectThis feedback button
 *
 * These primitives are deliberately small and stateless so they can be
 * rendered both standalone and inside CopilotKit-driven chat cards.
 */

interface SkeletonProps {
  lines?: number;
  /** When set, renders a card-shaped skeleton with title + meta + body. */
  card?: boolean;
}

export function Skeleton({ lines = 3, card = false }: SkeletonProps): JSX.Element {
  if (card) {
    return (
      <article className="card skeleton-card" aria-busy="true" aria-live="polite">
        <div className="skel skel-title" />
        <div className="skel skel-meta" />
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="skel skel-line" style={{ width: `${88 - i * 9}%` }} />
        ))}
      </article>
    );
  }
  return (
    <div aria-busy="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skel skel-line" style={{ width: `${92 - i * 12}%` }} />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  hint?: string;
}

export function EmptyState({ title, body, action, hint }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-orb" />
      <div className="empty-title">{title}</div>
      {body && <div>{body}</div>}
      {action && (
        <div style={{ marginTop: 16 }}>
          <button className="primary" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
      {hint && <div className="empty-hint">{hint}</div>}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps): JSX.Element {
  return (
    <div className="error-state" role="alert">
      <div className="error-icon" aria-hidden>!</div>
      <div className="error-message">{message}</div>
      {onRetry && (
        <button className="ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

interface ConfidenceBadgeProps {
  value: number; // 0–1
  /** Short prefix shown before the percent, e.g. "Confidence". */
  label?: string;
}

export function ConfidenceBadge({ value, label = 'Confidence' }: ConfidenceBadgeProps): JSX.Element {
  const pct = Math.round(value * 100);
  const tone = pct >= 80 ? 'success' : pct >= 55 ? '' : 'warn';
  const wordy = pct >= 80 ? 'high' : pct >= 55 ? 'medium' : 'low';
  const filled = pct >= 80 ? 3 : pct >= 55 ? 2 : 1;
  // A soft fill, not a pseudo-scientific percentage (design-guidelines.md).
  return (
    <span className={`pill ${tone} conf`} title={`${label}: ${wordy}`}>
      <span className="conf-dots" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`conf-dot ${i < filled ? 'on' : ''}`} />
        ))}
      </span>
      {wordy}
    </span>
  );
}

interface RiskBadgeProps {
  risk: 'none' | 'low' | 'medium' | 'high';
}

export function RiskBadge({ risk }: RiskBadgeProps): JSX.Element {
  const tone = risk === 'high' ? 'critical' : risk === 'medium' ? 'high' : risk === 'low' ? 'warn' : '';
  const label = risk === 'none' ? 'no risk' : `${risk} risk`;
  return <span className={`pill ${tone}`}>{label}</span>;
}

interface ReversibilityBadgeProps {
  reversible: boolean;
}

export function ReversibilityBadge({ reversible }: ReversibilityBadgeProps): JSX.Element {
  if (reversible) {
    return (
      <span className="pill success" title="You can undo this from the action history.">
        reversible
      </span>
    );
  }
  return (
    <span className="pill critical" title="Once applied, this cannot be undone from EmailSignal.">
      not reversible
    </span>
  );
}

interface WhyShownProps {
  /** Plain language: which signal triggered this suggestion. */
  reason: string;
}

export function WhyShown({ reason }: WhyShownProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className={`why ${open ? 'open' : ''}`}>
      <button
        className="why-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7.2v3.5M8 5.4v.1" />
        </svg>
        Why am I seeing this?
      </button>
      {open && <div className="why-body">{reason}</div>}
    </div>
  );
}

interface CorrectThisProps {
  onSubmit: (text: string) => void;
  label?: string;
}

export function CorrectThis({ onSubmit, label = 'Not right?' }: CorrectThisProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (done) return <span className="pill success">thanks — got it</span>;

  return (
    <div className={`correct ${open ? 'open' : ''}`}>
      {!open ? (
        <button className="ghost correct-trigger" onClick={() => setOpen(true)}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 11.5 11 3.5M7.5 7l1.5 1.5M3 13h3" />
          </svg>
          {label}
        </button>
      ) : (
        <div className="correct-form">
          <textarea
            ref={inputRef}
            className="input"
            rows={2}
            placeholder="What did we get wrong? e.g. 'this sender is important, not clutter'"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <div className="row" style={{ marginTop: 6, gap: 6 }}>
            <button
              className="primary"
              disabled={!text.trim()}
              onClick={() => {
                onSubmit(text.trim());
                setDone(true);
              }}
            >
              Send feedback
            </button>
            <button className="ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
