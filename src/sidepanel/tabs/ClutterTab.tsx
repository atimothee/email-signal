import React from 'react';
import { usePanelStore } from '../state/store';
import { ClutterSenderGroupCard } from '../cards/ClutterSenderGroupCard';
import { send } from '../state/bridge';

export function ClutterTab(): JSX.Element {
  const groups = usePanelStore((s) => s.groups);
  const proposedActions = usePanelStore((s) => s.proposedActions);

  if (groups.length === 0) {
    return (
      <div className="empty">
        No clutter detected yet. Scan an inbox first — we'll group senders and queue
        unsubscribe actions for your approval.
      </div>
    );
  }
  return (
    <>
      <div className="subtle" style={{ marginBottom: 10 }}>
        {groups.length} sender group{groups.length > 1 ? 's' : ''} ·{' '}
        {groups.reduce((acc, g) => acc + g.count, 0)} clutter message
        {groups.reduce((acc, g) => acc + g.count, 0) > 1 ? 's' : ''}
      </div>
      {groups.map((g) => {
        const queued = Object.values(proposedActions).some(
          (a) =>
            a.type === 'click_unsubscribe' &&
            (a.params['senderDomain'] as string | undefined) === g.senderDomain
        );
        return (
          <ClutterSenderGroupCard
            key={g.senderDomain}
            group={g}
            onUnsubscribe={
              queued
                ? undefined
                : () => send({ kind: 'panel/request_scan' /* re-trigger to ensure proposal */ })
            }
          />
        );
      })}
    </>
  );
}
