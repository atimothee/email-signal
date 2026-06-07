import React, { useState } from 'react';
import type { ClutterCategory, ClutterSenderGroup } from '@schemas/index';

interface SenderRow {
  group: ClutterSenderGroup;
  /** Has a pending unsubscribe proposal ready to approve. */
  canUnsubscribe: boolean;
}

interface Props {
  category: ClutterCategory;
  rows: SenderRow[];
  onUnsubscribe: (group: ClutterSenderGroup) => void;
  onMute: (group: ClutterSenderGroup) => void;
}

const CATEGORY_LABEL: Record<ClutterCategory, string> = {
  promotion: 'Promotions',
  newsletter: 'Newsletters',
  marketing: 'Marketing',
  cold_outreach: 'Cold outreach',
  automated_notification: 'Notifications',
  repeat_sender_low_signal: 'Low-signal senders',
  social_update: 'Social',
  receipt_or_confirmation: 'Receipts',
  other: 'Other noise',
};

/** A small accent class per theme so the buckets read at a glance with color. */
const CATEGORY_TINT: Record<ClutterCategory, string> = {
  promotion: 'c-promo',
  marketing: 'c-promo',
  newsletter: 'c-news',
  cold_outreach: 'c-cold',
  automated_notification: 'c-notify',
  repeat_sender_low_signal: 'c-notify',
  social_update: 'c-social',
  receipt_or_confirmation: 'c-receipt',
  other: 'c-other',
};

/**
 * One card per clutter THEME (not per email, not per sender). Aggregates the
 * noisy senders in that theme with counts, and offers the real, safe actions:
 * unsubscribe (per sender, gated by approval) and mute.
 */
export function CleanupThemeCard({ category, rows, onUnsubscribe, onMute }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const totalMessages = rows.reduce((acc, r) => acc + r.group.count, 0);
  const unsubCount = rows.filter((r) => r.canUnsubscribe).length;
  const visible = expanded ? rows : rows.slice(0, 3);

  return (
    <article className={`card cleanup ${CATEGORY_TINT[category]}`}>
      <div className="cleanup-head">
        <div className="cleanup-title">
          <span className="theme-chip">{CATEGORY_LABEL[category]}</span>
          <span className="faint">
            {rows.length} sender{rows.length === 1 ? '' : 's'} · {totalMessages} message
            {totalMessages === 1 ? '' : 's'}
          </span>
        </div>
        {unsubCount > 0 && <span className="pill warn">{unsubCount} can unsubscribe</span>}
      </div>

      <ul className="cleanup-senders">
        {visible.map((r) => (
          <li key={r.group.senderDomain} className="cleanup-sender">
            <div className="cleanup-sender-info">
              <span className="cleanup-sender-name">{r.group.senderDisplay}</span>
              <span className="faint">
                {r.group.senderDomain} · {r.group.count}
              </span>
            </div>
            <div className="cleanup-sender-actions">
              {r.canUnsubscribe && (
                <button className="primary slim" onClick={() => onUnsubscribe(r.group)}>
                  Unsubscribe
                </button>
              )}
              <button className="ghost slim" onClick={() => onMute(r.group)}>
                Mute
              </button>
            </div>
          </li>
        ))}
      </ul>

      {rows.length > 3 && (
        <button className="ghost slim cleanup-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : `Show ${rows.length - 3} more`}
        </button>
      )}
    </article>
  );
}

export { CATEGORY_LABEL };
