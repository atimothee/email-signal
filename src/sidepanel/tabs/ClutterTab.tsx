import React from 'react';
import { usePanelStore } from '../state/store';
import { ClutterSenderGroupCard } from '../cards/ClutterSenderGroupCard';
import { EmptyState } from '../cards/primitives';
import { send } from '../state/bridge';

export function ClutterTab(): JSX.Element {
  const groups = usePanelStore((s) => s.groups);
  const proposedActions = usePanelStore((s) => s.proposedActions);
  const lastError = usePanelStore((s) => s.lastError);

  if (groups.length === 0) {
    return (
      <EmptyState
        title="A clean inbox"
        body={
          lastError
            ? lastError
            : "Scan your inbox and we'll group noisy senders here so you can unsubscribe in a few clicks."
        }
        action={{ label: 'Scan inbox', onClick: () => send({ kind: 'panel/request_scan' }) }}
        hint="Unsubscribes always require per-sender confirmation."
      />
    );
  }

  const totalMessages = groups.reduce((acc, g) => acc + g.count, 0);

  return (
    <>
      <div className="subtle" style={{ marginTop: 4, marginBottom: 12 }}>
        {groups.length} noisy sender{groups.length === 1 ? '' : 's'} ·{' '}
        {totalMessages} message{totalMessages === 1 ? '' : 's'}
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
            onCorrect={(text) =>
              send({
                kind: 'panel/correct_finding',
                findingId: g.senderDomain,
                surface: 'clutter',
                correction: text,
              })
            }
          />
        );
      })}
    </>
  );
}
