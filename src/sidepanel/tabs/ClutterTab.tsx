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
        <div className="empty-orb" />
        <div className="empty-title">A clean inbox</div>
        <div>Scan your inbox and we'll group noisy senders here so you can unsubscribe in a few clicks.</div>
        <div style={{ marginTop: 16 }}>
          <button className="primary" onClick={() => send({ kind: 'panel/request_scan' })}>
            Scan inbox
          </button>
        </div>
      </div>
    );
  }

  const totalMessages = groups.reduce((acc, g) => acc + g.count, 0);

  return (
    <>
      <div className="subtle" style={{ marginTop: 4, marginBottom: 12 }}>
        {groups.length} noisy sender{groups.length === 1 ? '' : 's'} · {totalMessages} message{totalMessages === 1 ? '' : 's'}
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
