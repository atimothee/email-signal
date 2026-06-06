import React from 'react';
import type { ActionItem, ActionItemSuggestedAction } from '@schemas/index';

interface Props {
  item: ActionItem;
  onOpenThread?: (source: ActionItem['sources'][number]) => void;
  onSnooze?: () => void;
  onMarkDone?: () => void;
  onProposeReply?: (source: ActionItem['sources'][number]) => void;
}

const ACTION_LABEL: Record<ActionItemSuggestedAction, string> = {
  snooze: 'Snooze 1d',
  mark_done: 'Mark done',
  open_thread: 'Open thread',
  propose_reply: 'Propose reply',
};

function urgencyClass(u: ActionItem['urgency']): string {
  if (u === 'critical') return 'critical';
  if (u === 'high') return 'high';
  return '';
}

function formatDue(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'due today';
  return `due ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

export function ActionItemCard({ item, onOpenThread, onSnooze, onMarkDone, onProposeReply }: Props): JSX.Element {
  const due = formatDue(item.dueAt ?? null);
  const ucls = urgencyClass(item.urgency);

  return (
    <article className={`card action-item-card ${ucls === 'critical' ? 'accent' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <h3 style={{ minWidth: 0, flex: 1, fontSize: 15 }}>{item.action}</h3>
        {item.urgency !== 'normal' && <span className={`pill ${ucls}`}>{item.urgency}</span>}
      </div>

      <p style={{ fontSize: 13, margin: '6px 0 0', color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {item.why}
      </p>

      <div className="badge-row" style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {due && <span className={`pill ${ucls === 'critical' ? 'critical' : 'warn'}`}>{due}</span>}
        {item.sources.slice(0, 3).map((s) => (
          <button
            key={s.emailId}
            className="pill source-pill"
            onClick={() => onOpenThread?.(s)}
            title={s.subject}
            style={{ border: 'none', cursor: onOpenThread ? 'pointer' : 'default' }}
          >
            {s.senderDisplay}
          </button>
        ))}
        {item.sources.length > 3 && (
          <span className="pill">+{item.sources.length - 3} similar</span>
        )}
      </div>

      <div className="actions">
        {item.suggestedActions.map((a) => {
          switch (a) {
            case 'open_thread':
              return (
                <button key={a} onClick={() => onOpenThread?.(item.sources[0]!)}>
                  {ACTION_LABEL[a]}
                </button>
              );
            case 'propose_reply':
              return (
                <button key={a} className="ghost" onClick={() => onProposeReply?.(item.sources[0]!)}>
                  {ACTION_LABEL[a]}
                </button>
              );
            case 'mark_done':
              return (
                <button key={a} className="ghost" onClick={onMarkDone}>
                  {ACTION_LABEL[a]}
                </button>
              );
            case 'snooze':
              return (
                <button key={a} className="ghost" onClick={onSnooze}>
                  {ACTION_LABEL[a]}
                </button>
              );
          }
        })}
      </div>
    </article>
  );
}
