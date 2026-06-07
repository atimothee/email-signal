import React from 'react';
import { usePanelStore } from '../state/store';
import { CleanupThemeCard } from '../cards/CleanupThemeCard';
import { EmptyState, Skeleton, ErrorState } from '../cards/primitives';
import { send } from '../state/bridge';
import { normalizeProposedAction } from '@agents/action-factory';
import type { ClutterCategory, ClutterSenderGroup, ProposedAction } from '@schemas/index';

/** Order themes by how worth-acting-on they are. */
const CATEGORY_ORDER: ClutterCategory[] = [
  'promotion',
  'marketing',
  'newsletter',
  'cold_outreach',
  'social_update',
  'automated_notification',
  'repeat_sender_low_signal',
  'receipt_or_confirmation',
  'other',
];

function pendingUnsubByDomain(actions: Record<string, ProposedAction>): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of Object.values(actions)) {
    if (a.type === 'click_unsubscribe' && a.approvalStatus === 'pending') {
      const domain = a.params['senderDomain'] as string | undefined;
      if (domain) map.set(domain, a.id);
    }
  }
  return map;
}

export function ClutterTab(): JSX.Element {
  const groups = usePanelStore((s) => s.groups);
  const proposedActions = usePanelStore((s) => s.proposedActions);
  const scanStatus = usePanelStore((s) => s.scanStatus);
  const lastError = usePanelStore((s) => s.lastError);
  const removeProposedAction = usePanelStore((s) => s.removeProposedAction);
  const removeGroupsByDomain = usePanelStore((s) => s.removeGroupsByDomain);

  const scanning = scanStatus === 'reading' || scanStatus === 'thinking';

  if (groups.length === 0 && scanStatus === 'error') {
    return (
      <div>
        <ErrorState message={lastError ?? 'The Email Signal sidecar is unavailable.'} />
        <EmptyState
          title="Can't reach the sidecar"
          body="Cleanup needs the local Node sidecar running. Start it with “npm run server”, then scan again."
          action={{ label: 'Try again', onClick: () => send({ kind: 'panel/request_scan' }) }}
        />
      </div>
    );
  }

  if (groups.length === 0 && scanning) {
    return (
      <div>
        <div className="subtle" style={{ margin: '6px 0 12px' }}>Sorting the noise…</div>
        <Skeleton card lines={2} />
        <Skeleton card lines={2} />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        title="A clean inbox"
        body="Scan your inbox and I'll group noisy senders by theme so you can clear them in a few clicks."
        action={{ label: 'Scan inbox', onClick: () => send({ kind: 'panel/request_scan' }) }}
        hint="Every unsubscribe still needs your per-sender confirmation."
      />
    );
  }

  const pending = pendingUnsubByDomain(proposedActions);

  // Aggregate sender groups by theme.
  const byCategory = new Map<ClutterCategory, ClutterSenderGroup[]>();
  for (const g of groups) {
    const arr = byCategory.get(g.category) ?? [];
    arr.push(g);
    byCategory.set(g.category, arr);
  }

  const totalMessages = groups.reduce((acc, g) => acc + g.count, 0);
  const orderedCategories = CATEGORY_ORDER.filter((c) => byCategory.has(c));

  const approveUnsub = (g: ClutterSenderGroup) => {
    const id = pending.get(g.senderDomain);
    if (!id) return;
    send({
      kind: 'panel/approve_action',
      approval: {
        proposedActionId: id,
        status: 'approved',
        approvedAt: new Date().toISOString(),
        approvedBy: 'user',
      },
    });
    removeProposedAction(id);
  };

  // Mute is the "make this sender go away properly" action: hide it from future
  // scans, unsubscribe at the source when we have a link, and clear the noise
  // it already left. Every inbox-touching step (unsubscribe, mark_read) routes
  // through the policy gate, so dry-run and the kill switch still apply — Mute
  // never bypasses the safety model, it just bundles the approvals.
  const muteSender = (g: ClutterSenderGroup) => {
    // 1) Hide future: persist an ignored_sender preference the scan recalls.
    send({
      kind: 'panel/save_preference',
      preference: {
        id: `mute:${g.senderDomain}:${Date.now()}`,
        kind: 'ignored_sender',
        key: g.senderDomain,
        value: g.senderDomain,
        source: 'user_settings',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    // 2) Unsubscribe at the source when a (gated) proposal exists for this
    //    sender. No-ops for senders without a List-Unsubscribe link.
    approveUnsub(g);

    // 3) Clear the existing pile: mark each of this sender's messages read.
    //    rowAnchors carry the Gmail selectors resolved at scan time.
    for (const anchor of g.rowAnchors) {
      const action = normalizeProposedAction({
        type: 'mark_read',
        emailId: anchor.emailId,
        params: { rowSelector: anchor.rowSelector },
        proposedBy: 'orchestrator',
        rationale: `Muted ${g.senderDisplay}`,
      });
      send({ kind: 'panel/execute_action', action });
    }

    // 4) Optimistic feedback: the muted sender leaves the list immediately.
    removeGroupsByDomain(g.senderDomain);
  };

  return (
    <>
      <div className="subtle" style={{ marginTop: 4, marginBottom: 12 }}>
        {groups.length} noisy sender{groups.length === 1 ? '' : 's'} ·{' '}
        {totalMessages} message{totalMessages === 1 ? '' : 's'} across {orderedCategories.length}{' '}
        theme{orderedCategories.length === 1 ? '' : 's'}
      </div>
      {orderedCategories.map((category) => {
        const rows = byCategory
          .get(category)!
          .sort((a, b) => b.count - a.count)
          .map((group) => ({ group, canUnsubscribe: pending.has(group.senderDomain) }));
        return (
          <CleanupThemeCard
            key={category}
            category={category}
            rows={rows}
            onUnsubscribe={approveUnsub}
            onMute={muteSender}
          />
        );
      })}
    </>
  );
}
