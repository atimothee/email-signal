import React, { useState } from 'react';
import type { Decision } from '@schemas/index';
import { CorrectThis } from './primitives';

interface Props {
  /** Money-themed decisions to surface as payment reminders. */
  decisions: Decision[];
  /** Open the payment link (actionUrl) else the Gmail thread for this bill. */
  onPay?: (decision: Decision) => void;
  /** Mark this bill handled — it leaves Today and won't resurface. */
  onMarkPaid?: (decision: Decision) => void;
  /** Snooze the reminder out of Today until later. */
  onSnooze?: (decision: Decision) => void;
  onCorrect?: (decisionId: string, text: string) => void;
}

/**
 * A purpose-built generative-UI surface for money decisions. Where DecisionCard
 * is the generic synthesis card, this is the *bills* view: it leads with the
 * amount and the deadline (the two things you actually decide on for a payment),
 * sums the total outstanding, and sorts the most-overdue to the top. Rendered in
 * chat via the `show_payment_reminders` tool, and reusable on Today.
 *
 * Amounts are parsed best-effort from the synthesized title/why (the server
 * doesn't carry a structured amount), so the figure is a glanceable aid, never
 * an accounting source of truth — hence "≈" on the total.
 */
export function PaymentRemindersCard({
  decisions,
  onPay,
  onMarkPaid,
  onSnooze,
  onCorrect,
}: Props): JSX.Element {
  const sorted = [...decisions].sort(sortByUrgency);
  const total = sumTotal(sorted);
  const overdueCount = sorted.filter((d) => dueStatus(d.dueAt).kind === 'overdue').length;

  return (
    <section className="card pay-panel" aria-label="Payment reminders">
      <header className="pay-panel-head">
        <div className="pay-panel-title">
          <span className="theme-chip pay-chip">Payments</span>
          <span className="pay-count">
            {sorted.length} {sorted.length === 1 ? 'bill' : 'bills'}
            {overdueCount > 0 && (
              <span className="pay-overdue-tag"> · {overdueCount} overdue</span>
            )}
          </span>
        </div>
        {total && (
          <div className="pay-total" title="Approximate sum of amounts we could read from these emails">
            <span className="pay-total-label">due</span>
            <span className="pay-total-amount">≈ {total}</span>
          </div>
        )}
      </header>

      <ul className="pay-list">
        {sorted.map((d) => (
          <PaymentRow
            key={d.id}
            decision={d}
            onPay={onPay}
            onMarkPaid={onMarkPaid}
            onSnooze={onSnooze}
            onCorrect={onCorrect}
          />
        ))}
      </ul>
    </section>
  );
}

function PaymentRow({
  decision: d,
  onPay,
  onMarkPaid,
  onSnooze,
  onCorrect,
}: {
  decision: Decision;
  onPay?: (d: Decision) => void;
  onMarkPaid?: (d: Decision) => void;
  onSnooze?: (d: Decision) => void;
  onCorrect?: (id: string, text: string) => void;
}): JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const dispatch = (cb?: () => void) => {
    if (!cb) return;
    setLeaving(true);
    window.setTimeout(cb, 280);
  };

  const amount = parseAmount(`${d.title} ${d.why}`);
  const due = dueStatus(d.dueAt);
  const canPay = !!(d.actionUrl || d.threadLocator || d.rowSelector);
  const payLabel = d.actionUrl ? 'Pay now' : 'Open bill';

  return (
    <li
      className={`pay-row ${due.kind === 'overdue' ? 'is-overdue' : ''} ${d.demoted ? 'is-quiet' : ''} ${leaving ? 'leaving' : ''}`}
    >
      <div className="pay-row-main">
        <div className="pay-row-amount">{amount ?? '—'}</div>
        <div className="pay-row-body">
          <div className="pay-row-payee">{payeeLabel(d)}</div>
          <div className="pay-row-title">{d.title}</div>
        </div>
        <span className={`pay-due ${due.cls}`} title={d.dueAt ?? undefined}>
          {due.label}
        </span>
      </div>

      {d.demoted && d.demotedReason && <p className="pay-row-quiet">{d.demotedReason}</p>}

      <div className="pay-row-actions">
        <button
          className="primary pay-btn"
          disabled={!canPay}
          onClick={() => onPay?.(d)}
          title={canPay ? (d.actionUrl ? 'Open the payment link from this email' : 'Open this bill in Gmail') : undefined}
        >
          {payLabel}
        </button>
        {onMarkPaid && (
          <button
            className="ghost"
            onClick={() => dispatch(() => onMarkPaid(d))}
            title="I've paid this — clear it from Today"
          >
            Mark paid
          </button>
        )}
        {onSnooze && (
          <button
            className="ghost"
            onClick={() => dispatch(() => onSnooze(d))}
            title="Snooze this bill out of Today"
          >
            Snooze
          </button>
        )}
        {onCorrect && (
          <CorrectThis onSubmit={(t) => onCorrect(d.id, t)} label="Not a bill" />
        )}
      </div>
    </li>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function payeeLabel(d: Decision): string {
  const first = d.senders[0] ?? 'Unknown payee';
  const emails = d.count > 1 ? ` · ${d.count} emails` : '';
  return `${first}${emails}`;
}

type DueKind = 'overdue' | 'today' | 'soon' | 'later' | 'none';
interface Due {
  kind: DueKind;
  label: string;
  cls: string;
}

/** Human, glanceable deadline state from a forgiving date string. */
function dueStatus(value: string | null | undefined): Due {
  if (!value) return { kind: 'none', label: 'no date', cls: 'none' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { kind: 'none', label: value, cls: 'none' };

  const dayMs = 24 * 60 * 60 * 1000;
  const today = startOfDay(new Date());
  const target = startOfDay(d);
  const days = Math.round((target.getTime() - today.getTime()) / dayMs);

  if (days < 0) {
    const n = Math.abs(days);
    return { kind: 'overdue', label: `${n}d overdue`, cls: 'overdue' };
  }
  if (days === 0) return { kind: 'today', label: 'due today', cls: 'today' };
  if (days <= 3) return { kind: 'soon', label: `in ${days}d`, cls: 'soon' };
  return { kind: 'later', label: fmtDate(d), cls: 'later' };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Order bills the way you'd triage them: overdue first (most overdue at the
 * very top), then due-today, then soonest deadline; undated bills sink. Ties
 * break on urgency so a "critical" undated bill still outranks a "low" one.
 */
function sortByUrgency(a: Decision, b: Decision): number {
  const rank = (d: Decision): number => {
    const s = dueStatus(d.dueAt);
    const t = d.dueAt ? new Date(d.dueAt).getTime() : Number.POSITIVE_INFINITY;
    // Lower = higher priority. Past deadlines get the most-negative scores.
    if (s.kind === 'overdue' || s.kind === 'today' || s.kind === 'soon' || s.kind === 'later') {
      return Number.isNaN(t) ? 0 : t;
    }
    return Number.POSITIVE_INFINITY;
  };
  const byDate = rank(a) - rank(b);
  if (byDate !== 0) return byDate;
  const urgency = { critical: 0, high: 1, normal: 2, low: 3 } as const;
  return urgency[a.urgency] - urgency[b.urgency];
}

const CURRENCY = '(?:R|\\$|£|€|¥|US\\$|USD|ZAR|EUR|GBP|JPY|AUD|CAD)';
const NUMBER = '\\d{1,3}(?:[,\\s]\\d{3})*(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?';
// Symbol-before-number ("R1,240", "$45.00") or number-before-code ("45 USD").
const AMOUNT_RE = new RegExp(`(${CURRENCY})\\s?(${NUMBER})|(${NUMBER})\\s?(${CURRENCY})`, 'i');

interface Amount {
  symbol: string;
  value: number;
  display: string;
}

/** Best-effort currency extraction from synthesized copy. Null when none found. */
function parseAmountParts(text: string): Amount | null {
  const m = AMOUNT_RE.exec(text);
  if (!m) return null;
  const symbol = (m[1] ?? m[4] ?? '').toUpperCase();
  const raw = m[2] ?? m[3] ?? '';
  const value = Number(raw.replace(/[,\s]/g, ''));
  if (!Number.isFinite(value)) return null;
  const sym = (m[1] ?? m[4] ?? '').trim();
  // Keep symbol glued to the number; put currency *codes* (letters) after.
  const display = /^[A-Z$£€¥]+$/i.test(sym) && sym.length <= 2
    ? `${sym}${raw}`
    : `${raw} ${sym}`;
  return { symbol, value, display };
}

function parseAmount(text: string): string | null {
  return parseAmountParts(text)?.display ?? null;
}

/**
 * Sum only when every readable amount shares one currency — mixing R and $ into
 * a single figure would lie. Returns null otherwise (we just drop the total).
 */
function sumTotal(decisions: Decision[]): string | null {
  const parts = decisions
    .map((d) => parseAmountParts(`${d.title} ${d.why}`))
    .filter((a): a is Amount => a !== null);
  if (parts.length < 2) return null;
  const symbol = parts[0]!.symbol;
  if (!parts.every((p) => p.symbol === symbol)) return null;
  const sum = parts.reduce((acc, p) => acc + p.value, 0);
  const pretty = sum.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const sym = symbol.length <= 2 ? symbol.replace('USD', '$') : symbol;
  return /^[A-Z]{3}$/.test(sym) ? `${pretty} ${sym}` : `${sym}${pretty}`;
}
