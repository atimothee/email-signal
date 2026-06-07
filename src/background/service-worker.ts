/// <reference types="chrome" />
import { onMessage, sendToTab } from '@/common/messaging';
import { ALARMS, DEFAULTS, STORAGE_KEYS } from '@/common/constants';
import { log } from '@/common/log';
import { runOrchestratorTurn } from '@agents/orchestrator';
import { USER_ID } from '@agents/runtime';
import { getMemoryStore } from '@/memory';
import { appendLedger, getLedger } from '@/ledger/local-ledger';
import { recordTrace } from '@/weave/tracing';
import { AccountIdentitySchema } from '@schemas/index';
import type { ExtMessage } from '@schemas/index';

/**
 * Disposable Gmail tabs we opened just to paginate-scan (Option B, brief-focus
 * hybrid). Maps the scan tab's id -> the user's original tab to re-focus when
 * we're done. When a scan_result arrives from one of these, we restore focus
 * and close it.
 */
const bgScanTabs = new Map<number, number | undefined>();

/** Resolve when a tab finishes loading, or reject after `timeoutMs`. */
function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      if (ok) resolve();
      else reject(new Error('Background Gmail tab load timed out'));
    };
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') finish(true);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    // It may already be complete before we attached the listener.
    chrome.tabs.get(tabId).then(
      (t) => {
        if (t.status === 'complete') finish(true);
      },
      () => finish(false)
    );
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Normalize a Gmail tab URL into a clean inbox URL for the SAME account
 * (/mail/u/N/). We scan from a fresh #inbox view so pagination starts at page 1.
 */
function buildInboxUrl(srcUrl: string | undefined): string {
  const m = srcUrl?.match(/mail\.google\.com\/mail\/u\/(\d+)/);
  const u = m?.[1] ?? '0';
  return `https://mail.google.com/mail/u/${u}/#inbox`;
}

/** Best-effort: re-focus a tab, then remove the disposable scan tab. */
async function restoreFocusAndClose(scanTabId: number, refocusTabId: number | undefined): Promise<void> {
  if (refocusTabId !== undefined) {
    try {
      await chrome.tabs.update(refocusTabId, { active: true });
    } catch {
      /* original tab may be gone */
    }
  }
  try {
    await chrome.tabs.remove(scanTabId);
  } catch {
    /* already gone */
  }
}

/**
 * Open a disposable Gmail tab, briefly FOCUS it (so Gmail actually renders and
 * honors page navigation — a hidden tab rejects both clicks and #p2 hash nav),
 * let its content script paginate the inbox, then return focus to the user's
 * original tab and close the scan tab (done in `content/scan_result`). The
 * user's own Gmail tab is never paged. Requires an existing signed-in Gmail tab
 * so we know the account + have a session.
 */
async function launchBackgroundScan(): Promise<void> {
  const existing = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  if (existing.length === 0) {
    await broadcastToPanel({
      kind: 'bg/error',
      message:
        'No Gmail tab found. Open https://mail.google.com (and sign in), then click Scan now again.',
    });
    await recordTrace({ kind: 'error', message: 'No Gmail tab found for background scan' });
    return;
  }
  const srcUrl = existing.find((t) => t.active)?.url ?? existing[0]?.url;
  const scanUrl = buildInboxUrl(srcUrl);

  // Remember which tab to return focus to once the scan finishes.
  const [activeNow] = await chrome.tabs.query({ active: true, currentWindow: true });
  const refocusTabId = activeNow?.id;

  // Show a real "reading" state immediately.
  await broadcastToPanel({ kind: 'bg/turn_started', trigger: 'scan' });
  await broadcastToPanel({ kind: 'bg/scan_progress', phase: 'reading', loaded: 0 });

  let tabId: number | undefined;
  try {
    // active:true — the tab must be visible/foreground for Gmail to paginate.
    const tab = await chrome.tabs.create({ url: scanUrl, active: true });
    tabId = tab.id;
    if (tabId === undefined) throw new Error('Could not open a Gmail scan tab');
    bgScanTabs.set(tabId, refocusTabId);

    await waitForTabComplete(tabId, DEFAULTS.bgTabReadyTimeoutMs);
    // Small settle so Gmail's SPA can build the row DOM; the scanner also
    // waits for rows itself, so this just trims the first retry.
    await new Promise((r) => setTimeout(r, 1200));

    const ok = await sendToTab(tabId, { kind: 'bg/request_scan', source: 'inbox', background: true });
    if (!ok) throw new Error('Scan tab content script unreachable');
    // The scan now runs in that tab; content/scan_result finishes + closes it.
  } catch (err) {
    if (tabId !== undefined) {
      bgScanTabs.delete(tabId);
      await restoreFocusAndClose(tabId, refocusTabId);
    }
    await broadcastToPanel({ kind: 'bg/error', message: (err as Error).message });
    await broadcastToPanel({ kind: 'bg/turn_done', ok: false });
    await recordTrace({ kind: 'error', message: `Background scan failed: ${(err as Error).message}` });
  }
}

// Open the side panel when the user clicks the toolbar icon.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    log.warn('sidePanel API unavailable', err);
  }
  // Scans are on-demand only. A periodic background scan would have to focus a
  // Gmail tab to paginate (Gmail won't paginate a hidden tab), which would steal
  // focus on a timer — so we clear any previously-scheduled alarm and never
  // create one. Users scan via the side panel's "Scan now".
  await chrome.alarms.clear(ALARMS.periodicScan);
});

onMessage(async (msg, sender) => {
  try {
    switch (msg.kind) {
      case 'content/ready': {
        log.info('content ready on tab', sender.tab?.id);
        return;
      }
      case 'content/scan_progress': {
        await broadcastToPanel({
          kind: 'bg/scan_progress',
          phase: 'reading',
          loaded: msg.loaded,
          target: msg.target,
        });
        return;
      }
      case 'content/scan_result': {
        const tabId = sender.tab?.id;
        const isBgScan = tabId !== undefined && bgScanTabs.has(tabId);
        // Log here (persists) because the disposable scan tab closes below,
        // taking its own console with it.
        log.info('scan result', {
          count: msg.scan.candidates.length,
          background: isBgScan,
          warnings: msg.scan.warnings,
        });
        // For a background scan, the disposable tab can't execute DOM actions
        // (it's about to close), so don't hand it to the orchestrator as the
        // action target — the user's real Gmail tab handles those.
        await runOrchestratorTurn({
          trigger: 'scan',
          scan: msg.scan,
          sourceTabId: isBgScan ? undefined : tabId,
        });
        if (isBgScan && tabId !== undefined) {
          const refocusTabId = bgScanTabs.get(tabId);
          bgScanTabs.delete(tabId);
          await restoreFocusAndClose(tabId, refocusTabId);
        }
        return;
      }
      case 'content/account_identity': {
        // Persist so the panel can hydrate on open even before the next scan,
        // and broadcast for any panel that's already listening.
        await chrome.storage.local.set({ [STORAGE_KEYS.account]: msg.identity });
        await broadcastToPanel({ kind: 'bg/account_identity', identity: msg.identity });
        return;
      }
      case 'content/dom_action_result': {
        const updated = await appendLedger({
          proposedActionId: msg.proposedActionId,
          executed: {
            ok: msg.ok,
            error: msg.error,
            before: msg.before,
            after: msg.after,
          },
        });
        if (updated) await broadcastToPanel({ kind: 'bg/ledger_entry', entry: updated });
        await recordTrace({
          kind: msg.ok ? 'action_executed' : 'error',
          message: msg.ok ? 'DOM action executed' : msg.error ?? 'DOM action failed',
          data: { proposedActionId: msg.proposedActionId },
        });
        return;
      }
      case 'panel/hello': {
        // Re-emit recent ledger so the side panel can hydrate on open.
        const entries = await getLedger();
        for (const e of entries.slice(-50)) {
          await broadcastToPanel({ kind: 'bg/ledger_entry', entry: e });
        }
        // Re-emit the last-known connected account so the top bar fills in
        // immediately, even if the Gmail tab reported it before the panel opened.
        const storedAccount = (await chrome.storage.local.get(STORAGE_KEYS.account))[
          STORAGE_KEYS.account
        ];
        const account = AccountIdentitySchema.safeParse(storedAccount);
        if (account.success) {
          await broadcastToPanel({ kind: 'bg/account_identity', identity: account.data });
        }
        return;
      }
      case 'panel/request_scan': {
        // Option B: scan in a disposable, unfocused Gmail tab that paginates
        // through Older pages, so the user's own inbox view is never disturbed.
        await launchBackgroundScan();
        return;
      }
      case 'panel/highlight': {
        // Forward a highlight request from the panel to the Gmail tab(s).
        const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
        for (const t of tabs) {
          if (t.id) await sendToTab(t.id, { kind: 'bg/highlight', selector: msg.selector });
        }
        return;
      }
      case 'panel/open_thread': {
        // Jump to a decision's email: focus the Gmail tab and ask its content
        // script to navigate to the thread (pagination-proof locator) or, failing
        // that, highlight the row. If no Gmail tab is open we simply no-op here;
        // the panel shows its own "Open Gmail to jump here" toast.
        const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
        const target = tabs[0];
        if (target?.id) {
          await chrome.tabs.update(target.id, { active: true });
          if (target.windowId !== undefined) {
            await chrome.windows.update(target.windowId, { focused: true });
          }
          await sendToTab(target.id, {
            kind: 'bg/open_thread',
            locator: msg.locator ?? null,
            fallbackSelector: msg.fallbackSelector ?? null,
          });
        }
        return;
      }
      case 'panel/request_brief': {
        await runOrchestratorTurn({ trigger: 'brief' });
        return;
      }
      case 'panel/chat_message': {
        await runOrchestratorTurn({ trigger: 'chat', userText: msg.text });
        return;
      }
      case 'panel/approve_action': {
        await runOrchestratorTurn({ trigger: 'approval', approval: msg.approval });
        return;
      }
      case 'panel/execute_action': {
        // Chat-approved action that isn't in the ledger yet: record → gate →
        // execute → log, all inside the orchestrator turn.
        await runOrchestratorTurn({ trigger: 'execute', action: msg.action });
        return;
      }
      case 'panel/reject_action': {
        const updated = await appendLedger({
          proposedActionId: msg.proposedActionId,
          approval: {
            proposedActionId: msg.proposedActionId,
            status: 'rejected',
            approvedBy: 'user',
          },
        });
        if (updated) await broadcastToPanel({ kind: 'bg/ledger_entry', entry: updated });
        return;
      }
      case 'panel/kill_switch': {
        await chrome.storage.local.set({ [STORAGE_KEYS.killSwitch]: msg.enabled });
        return;
      }
      case 'panel/set_dry_run': {
        await chrome.storage.local.set({ [STORAGE_KEYS.dryRun]: msg.enabled });
        return;
      }
      case 'panel/save_preference': {
        // Write through the memory store (es.mem.prefs, keyed by USER_ID) — the
        // SAME store the scan recalls from via listPreferences. Writing to the
        // old flat preferences array was a dead end the scan never read, which
        // is what made Mute / "ignore sender" no-ops.
        const store = await getMemoryStore();
        await store.upsertPreference(USER_ID, msg.preference);
        return;
      }
      case 'panel/decision_action': {
        // Persist a per-decision disposition keyed by emailId so a re-scan
        // honours it. 'restore' (undo) clears it. Keyed to match the
        // orchestrator's DECISION_STATE_KEY filter.
        const key = 'emailsignal_decision_state';
        const state =
          ((await chrome.storage.local.get(key))[key] as
            | Record<string, { status: 'handled' | 'snoozed'; until?: number }>
            | undefined) ?? {};
        for (const emailId of msg.emailIds) {
          if (msg.action === 'restore') delete state[emailId];
          else state[emailId] = { status: msg.action === 'handled' ? 'handled' : 'snoozed', until: msg.untilMs };
        }
        await chrome.storage.local.set({ [key]: state });
        return;
      }
      case 'panel/batch_approve': {
        for (const id of msg.proposedActionIds) {
          await runOrchestratorTurn({
            trigger: 'approval',
            approval: {
              proposedActionId: id,
              status: 'approved',
              approvedAt: msg.confirmedAt,
              approvedBy: 'user',
              note: 'batch-approved',
            },
          });
        }
        await recordTrace({
          kind: 'approval_granted',
          message: `batch approval: ${msg.proposedActionIds.length} action(s)`,
          data: { proposedActionIds: msg.proposedActionIds },
        });
        return;
      }
      case 'panel/always_suggest':
      case 'panel/never_suggest': {
        const kindKey = msg.kind === 'panel/always_suggest' ? 'liked_newsletter' : 'ignored_sender';
        const pref = {
          id: `${msg.kind}:${msg.patternKey}:${Date.now()}`,
          kind: kindKey as 'liked_newsletter' | 'ignored_sender',
          key: msg.patternKey,
          // The value MUST be the sender/pattern itself — the synthesis step
          // matches ignored_sender preferences against decision senders. Storing
          // the literal "never_suggest" here is what made muting a no-op.
          value: msg.patternKey,
          source: 'agent_suggested_then_approved' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        // Same memory store the scan recalls from — see panel/save_preference.
        const store = await getMemoryStore();
        await store.upsertPreference(USER_ID, pref);
        await recordTrace({
          kind: 'approval_granted',
          message: msg.kind,
          data: { patternKey: msg.patternKey, proposedActionId: msg.proposedActionId },
        });
        return;
      }
      case 'panel/correct_action':
      case 'panel/correct_finding': {
        // Persist as a structured correction the orchestrator can pick up next turn.
        const correctionsKey = 'emailsignal_corrections';
        const existing =
          ((await chrome.storage.local.get(correctionsKey))[correctionsKey] as unknown[]) ?? [];
        existing.push({ ...msg, at: new Date().toISOString() });
        await chrome.storage.local.set({ [correctionsKey]: existing });
        await recordTrace({
          kind: 'approval_rejected',
          message: 'user correction',
          data: { kind: msg.kind, text: msg.correction },
        });
        return;
      }
      default:
        // Background-originated messages echoing back from another surface; ignore.
        return;
    }
  } catch (err) {
    log.error('service-worker handler error', err);
    await broadcastToPanel({ kind: 'bg/error', message: (err as Error).message });
  }
});

export async function broadcastToPanel(msg: ExtMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // side panel might not be open
  }
}
