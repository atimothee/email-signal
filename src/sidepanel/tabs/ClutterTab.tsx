import React, { useEffect, useState } from 'react';
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

/** A Mute whose inbox-clearing actions are dispatched and being tracked, so the
 *  confirmation can report the REAL count of messages cleared (from ledger
 *  results) instead of an optimistic guess (#72, Defect 2). */
interface MutePending {
  name: string;
  willUnsub: boolean;
  /** The dispatched mark_read action ids we're waiting on ledger results for. */
  ids: string[];
  total: number;
}

/** A Mute that Dry run gated off, kept so the toast's nudge can re-run it live
 *  once the user turns Dry run off (#72, Defect A). */
interface DryRunRetry {
  group: ClutterSenderGroup;
  willUnsub: boolean;
}

/**
 * The honest note when Gmail is gated OFF (kill switch / dry run): the
 * hide-from-app part always sticks, but nothing changed in Gmail. Returns null
 * when neither gate is active (the live path reports real counts instead).
 */
function gatedMuteNote(
  name: string,
  willUnsub: boolean,
  dryRun: boolean,
  killSwitch: boolean
): string | null {
  if (killSwitch) {
    return `Hid ${name} here. Kill switch is on, so nothing was changed in Gmail.`;
  }
  if (dryRun) {
    const what = willUnsub ? 'unsubscribe & clear it' : 'clear it';
    return `Hid ${name} here. Dry run is on — turn it off to ${what} in Gmail.`;
  }
  return null;
}

/** Live note reflecting the REAL number of messages cleared so far. */
function liveMuteNote(name: string, willUnsub: boolean, ok: number, total: number): string {
  const parts: string[] = [];
  if (willUnsub) parts.push('unsubscribed');
  if (total > 0) parts.push(ok === total ? `${ok} marked read` : `${ok}/${total} marked read`);
  return parts.length
    ? `Muted ${name} — ${parts.join(', ')}.`
    : `Muted ${name} — hidden from future scans.`;
}

export function ClutterTab(): JSX.Element {
  const groups = usePanelStore((s) => s.groups);
  const proposedActions = usePanelStore((s) => s.proposedActions);
  const scanStatus = usePanelStore((s) => s.scanStatus);
  const lastError = usePanelStore((s) => s.lastError);
  const removeProposedAction = usePanelStore((s) => s.removeProposedAction);
  const removeGroupsByDomain = usePanelStore((s) => s.removeGroupsByDomain);
  const dryRun = usePanelStore((s) => s.dryRun);
  const killSwitch = usePanelStore((s) => s.killSwitch);
  const setDryRun = usePanelStore((s) => s.setDryRun);
  const ledger = usePanelStore((s) => s.ledger);

  // One consolidated, honest confirmation per Mute (no per-email noise). Mirrors
  // the Today tab's undo snackbar. Auto-dismisses after a few seconds.
  const [muteNote, setMuteNote] = useState<string | null>(null);
  // The in-flight live Mute we're tracking ledger results for, and a Dry-run Mute
  // we can re-run live if the user takes the nudge.
  const [mutePending, setMutePending] = useState<MutePending | null>(null);
  const [dryRunRetry, setDryRunRetry] = useState<DryRunRetry | null>(null);
  useEffect(() => {
    if (!muteNote) return;
    const t = window.setTimeout(() => {
      setMuteNote(null);
      setDryRunRetry(null);
    }, 6000);
    return () => window.clearTimeout(t);
  }, [muteNote]);

  // As mark_read results land in the ledger, refresh the confirmation with the
  // REAL count of messages cleared (#72, Defect 2). A row that errors ('row not
  // found', etc.) comes back ok:false and simply isn't counted, so the toast can
  // never over-promise. Finalize once every dispatched action has reported.
  useEffect(() => {
    if (!mutePending) return;
    const { ids, total, name, willUnsub } = mutePending;
    const idSet = new Set(ids);
    const results = ledger.filter((e) => idSet.has(e.proposed.id) && e.executed);
    const ok = results.filter(
      (e) => e.executed!.result.ok && !e.executed!.result.after?.['dryRun']
    ).length;
    setMuteNote(liveMuteNote(name, willUnsub, ok, total));
    if (results.length >= total) setMutePending(null);
  }, [ledger, mutePending]);

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

  // Dispatch the inbox-clearing half of a Mute (unsubscribe + mark each message
  // read) and return the dispatched mark_read action ids so the caller can track
  // their real ledger results. Each mark_read carries the stable messageId so the
  // content script re-finds the row by identity in the user's real tab — not by
  // the positional selector resolved in the disposable scan tab (#72, Defect B).
  // Every step still routes through the policy gate (dry-run / kill switch apply).
  const dispatchClear = (g: ClutterSenderGroup, willUnsub: boolean): string[] => {
    if (willUnsub) approveUnsub(g);
    const ids: string[] = [];
    for (const anchor of g.rowAnchors) {
      const action = normalizeProposedAction({
        type: 'mark_read',
        emailId: anchor.emailId,
        params: {
          rowSelector: anchor.rowSelector,
          ...(anchor.messageId ? { messageId: anchor.messageId } : {}),
        },
        proposedBy: 'orchestrator',
        rationale: `Muted ${g.senderDisplay}`,
      });
      ids.push(action.id);
      send({ kind: 'panel/execute_action', action });
    }
    return ids;
  };

  // Mute is the "make this sender go away properly" action: hide it from future
  // scans, unsubscribe at the source when we have a link, and clear the noise
  // it already left. The hide-from-app part always sticks; the Gmail mutations
  // (unsubscribe, mark_read) route through the policy gate, so dry-run and the
  // kill switch still apply — Mute never bypasses the safety model.
  const muteSender = (g: ClutterSenderGroup) => {
    const willUnsub = pending.has(g.senderDomain);

    // 1) Hide future: persist an ignored_sender preference the scan recalls.
    //    Local to the app and ALWAYS takes effect — not a Gmail mutation, so
    //    dry-run / kill-switch don't suppress it. A re-scan now also drops the
    //    sender deterministically (#72, Defect C), so it won't reappear here.
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

    // The muted sender leaves the list immediately either way.
    removeGroupsByDomain(g.senderDomain);

    // 2) When Gmail is gated off, say so honestly and DON'T dispatch — keep the
    //    sender's unsubscribe/rows intact so the Dry-run nudge can clear it live.
    const gated = gatedMuteNote(g.senderDisplay, willUnsub, dryRun, killSwitch);
    if (gated) {
      setMutePending(null);
      setDryRunRetry(dryRun && !killSwitch ? { group: g, willUnsub } : null);
      setMuteNote(gated);
      return;
    }

    // 3) Live: clear the pile and track real ledger results for the toast count.
    const ids = dispatchClear(g, willUnsub);
    setDryRunRetry(null);
    setMutePending({ name: g.senderDisplay, willUnsub, ids, total: ids.length });
    setMuteNote(liveMuteNote(g.senderDisplay, willUnsub, 0, ids.length));
  };

  // Dry-run nudge: turn Dry run off, then clear the sender we just muted for real
  // (#72, Defect A). The short delay lets the set_dry_run storage write land
  // before the execute turn reads it.
  const turnOffDryRunAndClear = () => {
    if (!dryRunRetry) return;
    const { group, willUnsub } = dryRunRetry;
    setDryRun(false);
    send({ kind: 'panel/set_dry_run', enabled: false });
    setDryRunRetry(null);
    window.setTimeout(() => {
      const ids = dispatchClear(group, willUnsub);
      setMutePending({ name: group.senderDisplay, willUnsub, ids, total: ids.length });
      setMuteNote(liveMuteNote(group.senderDisplay, willUnsub, 0, ids.length));
    }, 250);
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
            onMute={muteSender}
          />
        );
      })}
      {muteNote && (
        <div className="undo-bar" role="status">
          <span>{muteNote}</span>
          {dryRunRetry && (
            <button type="button" onClick={turnOffDryRunAndClear}>
              Turn off Dry run &amp; clear now
            </button>
          )}
        </div>
      )}
    </>
  );
}
