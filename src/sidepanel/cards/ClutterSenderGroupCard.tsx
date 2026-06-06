import React from 'react';
import type { ClutterSenderGroup } from '@schemas/index';

interface Props {
  group: ClutterSenderGroup;
  onUnsubscribe?: () => void;
  onMarkRead?: () => void;
  onIgnore?: () => void;
}

export function ClutterSenderGroupCard({
  group,
  onUnsubscribe,
  onMarkRead,
  onIgnore,
}: Props): JSX.Element {
  return (
    <article className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>{group.senderDisplay}</h3>
        <span className="pill">{group.category.replace('_', ' ')}</span>
      </div>
      <div className="meta">
        {group.senderDomain} · {group.count} message{group.count > 1 ? 's' : ''} · confidence{' '}
        {(group.averageConfidence * 100).toFixed(0)}%
      </div>
      <ul style={{ margin: '8px 0', paddingLeft: 16, fontSize: 12 }}>
        {group.exampleSubjects.map((s, i) => (
          <li key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s}
          </li>
        ))}
      </ul>
      <div className="rationale">{group.rationale}</div>
      <div className="actions">
        {group.suggestedActions.includes('unsubscribe') && onUnsubscribe && (
          <button className="primary" onClick={onUnsubscribe}>
            Queue unsubscribe
          </button>
        )}
        {onMarkRead && <button onClick={onMarkRead}>Mark all read</button>}
        {onIgnore && (
          <button className="ghost" onClick={onIgnore}>
            Ignore sender
          </button>
        )}
      </div>
    </article>
  );
}
