import React, { useState } from 'react';
import type { ClutterSenderGroup } from '@schemas/index';
import { ConfidenceBadge, CorrectThis, WhyShown } from './primitives';

interface Props {
  group: ClutterSenderGroup;
  onUnsubscribe?: () => void;
  onMarkRead?: () => void;
  onIgnore?: () => void;
  onCorrect?: (text: string) => void;
}

/**
 * V1 policy: unsubscribe clicks REQUIRE per-sender confirmation. The first
 * "Unsubscribe" tap reveals an explicit confirmation step before any action
 * is proposed.
 */
export function ClutterSenderGroupCard({
  group,
  onUnsubscribe,
  onMarkRead,
  onIgnore,
  onCorrect,
}: Props): JSX.Element {
  const [confirming, setConfirming] = useState(false);

  const canUnsub = group.suggestedActions.includes('unsubscribe') && onUnsubscribe;

  return (
    <article className="card">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <h3 style={{ minWidth: 0, flex: 1 }}>{group.senderDisplay}</h3>
        <span className="pill">{group.category.replace(/_/g, ' ')}</span>
      </div>
      <div className="meta">
        {group.senderDomain} · {group.count} message{group.count > 1 ? 's' : ''}
      </div>

      <div className="badge-row" style={{ marginTop: 6 }}>
        <ConfidenceBadge value={group.averageConfidence} />
      </div>

      <ul style={{ margin: '8px 0', paddingLeft: 16, fontSize: 12, color: 'var(--text-dim)' }}>
        {group.exampleSubjects.map((s, i) => (
          <li key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s}
          </li>
        ))}
      </ul>
      <div className="rationale">{group.rationale}</div>

      <WhyShown
        reason={`Grouped because ${group.count} messages from ${group.senderDomain} matched the ${group.category.replace(/_/g, ' ')} pattern.`}
        evidence={`Average confidence ${(group.averageConfidence * 100).toFixed(0)}%.`}
      />

      {confirming && canUnsub && (
        <div className="effect-preview" style={{ borderLeftColor: 'var(--warn)' }}>
          <div className="label">Confirm unsubscribe</div>
          <div>
            We'll open <code>{group.senderDomain}</code>'s unsubscribe page in a new tab. You
            will confirm on their page — EmailSignal never clicks the final unsubscribe
            button. This is a per-sender confirmation; we do not batch unsubscribes.
          </div>
        </div>
      )}

      <div className="actions">
        {canUnsub && !confirming && (
          <button className="primary" onClick={() => setConfirming(true)}>
            Unsubscribe…
          </button>
        )}
        {canUnsub && confirming && (
          <>
            <button
              className="primary"
              onClick={() => {
                setConfirming(false);
                onUnsubscribe!();
              }}
            >
              Yes, open unsubscribe page
            </button>
            <button className="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        )}
        {onMarkRead && <button onClick={onMarkRead}>Mark all read</button>}
        {onIgnore && (
          <button className="ghost" onClick={onIgnore}>
            Ignore sender
          </button>
        )}
      </div>

      {onCorrect && (
        <div style={{ marginTop: 8 }}>
          <CorrectThis onSubmit={onCorrect} label="This isn't clutter" />
        </div>
      )}
    </article>
  );
}
