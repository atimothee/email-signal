/// <reference types="chrome" />
import { onMessage, sendToTab } from '@/common/messaging';
import { ALARMS, DEFAULTS, STORAGE_KEYS } from '@/common/constants';
import { log } from '@/common/log';
import { runOrchestratorTurn } from '@agents/orchestrator';
import { appendLedger, getLedger } from '@/ledger/local-ledger';
import { recordTrace } from '@/weave/tracing';
import type { ExtMessage } from '@schemas/index';

// Open the side panel when the user clicks the toolbar icon.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    log.warn('sidePanel API unavailable', err);
  }
  await chrome.alarms.create(ALARMS.periodicScan, {
    periodInMinutes: DEFAULTS.notifyIntervalMin,
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARMS.periodicScan) return;
  const killed = (await chrome.storage.local.get(STORAGE_KEYS.killSwitch))[
    STORAGE_KEYS.killSwitch
  ] as boolean | undefined;
  if (killed) return;
  // Ask the active Gmail tab (if any) for a fresh scan.
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  for (const t of tabs) {
    if (t.id) await sendToTab(t.id, { kind: 'bg/request_scan', source: 'inbox' });
  }
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
        await runOrchestratorTurn({ trigger: 'scan', scan: msg.scan, sourceTabId: sender.tab?.id });
        return;
      }
      case 'content/dom_action_result': {
        await appendLedger({
          proposedActionId: msg.proposedActionId,
          executed: {
            ok: msg.ok,
            error: msg.error,
            before: msg.before,
            after: msg.after,
          },
        });
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
        return;
      }
      case 'panel/request_scan': {
        // Look first for the active Gmail tab; if there isn't one focused,
        // fall back to ANY open Gmail tab so the user can leave Gmail in the
        // background and still scan from the side panel.
        let tabs = await chrome.tabs.query({
          active: true,
          url: 'https://mail.google.com/*',
        });
        if (tabs.length === 0) {
          tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
        }
        if (tabs.length === 0) {
          await broadcastToPanel({
            kind: 'bg/error',
            message:
              'No Gmail tab found. Open https://mail.google.com in a tab, then click Scan now again.',
          });
          await recordTrace({
            kind: 'error',
            message: 'No Gmail tab found',
          });
          return;
        }
        let delivered = 0;
        for (const t of tabs) {
          if (t.id && (await sendToTab(t.id, { kind: 'bg/request_scan', source: 'inbox' }))) {
            delivered++;
          }
        }
        if (delivered > 0) {
          // Announce the turn immediately so the panel shows a real "reading"
          // state the instant the user clicks Scan — not a fake spinner.
          await broadcastToPanel({ kind: 'bg/turn_started', trigger: 'scan' });
          await broadcastToPanel({ kind: 'bg/scan_progress', phase: 'reading', loaded: 0 });
        }
        if (delivered === 0) {
          await broadcastToPanel({
            kind: 'bg/error',
            message:
              "Couldn't reach Gmail. Reload the Gmail tab (Cmd+R on mail.google.com) and try Scan again.",
          });
          await recordTrace({
            kind: 'error',
            message: 'Gmail tab found but content script unreachable',
          });
        }
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
      case 'panel/reject_action': {
        await appendLedger({
          proposedActionId: msg.proposedActionId,
          approval: {
            proposedActionId: msg.proposedActionId,
            status: 'rejected',
            approvedBy: 'user',
          },
        });
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
        const existing =
          ((await chrome.storage.local.get(STORAGE_KEYS.preferences))[
            STORAGE_KEYS.preferences
          ] as Record<string, unknown>[]) ?? [];
        existing.push(msg.preference);
        await chrome.storage.local.set({ [STORAGE_KEYS.preferences]: existing });
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
          value: msg.kind === 'panel/always_suggest' ? 'always_suggest' : 'never_suggest',
          source: 'agent_suggested_then_approved' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const existing =
          ((await chrome.storage.local.get(STORAGE_KEYS.preferences))[
            STORAGE_KEYS.preferences
          ] as Record<string, unknown>[]) ?? [];
        existing.push(pref);
        await chrome.storage.local.set({ [STORAGE_KEYS.preferences]: existing });
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
