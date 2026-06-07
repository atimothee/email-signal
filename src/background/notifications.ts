/**
 * Chrome notifications for Email Signal (issue #1).
 *
 * Scope note: the V1 spec imagined a periodic background-scan ALARM that would
 * nudge the user. That alarm was deliberately removed — Gmail won't paginate a
 * hidden tab, so a timer-driven scan would have to STEAL FOCUS (see
 * service-worker.ts onInstalled). Scans are on-demand now, so notifications fire
 * on scan COMPLETION instead of on a timer. They are strictly OPT-IN (default
 * OFF) and respect the kill switch, so nothing surprises the user.
 *
 * What we notify on:
 *  - ≥1 high-priority (critical/high) decision surfaced  → "N need you today"
 *    (this IS today's brief, so it doubles as the "daily brief ready" nudge and
 *    is capped at most once per calendar day)
 *  - ≥ notifyUnsubBatchMin senders ready to clean up      → "unsubscribe batch ready"
 * Each notification type can be turned off independently (per-category opt-out).
 * Identical results don't re-notify (signature dedup), and clicking opens the
 * side panel.
 */
import { STORAGE_KEYS, DEFAULTS } from '@/common/constants';
import { log } from '@/common/log';
import type { Decision, ClutterSenderGroup } from '@schemas/index';

const NOTIFY_ID_DECISIONS = 'email-signal:decisions';
const NOTIFY_ID_CLUTTER = 'email-signal:clutter';

interface NotifyState {
  lastDecisionSig?: string;
  lastClutterSig?: string;
  /** YYYY-MM-DD of the last decisions/brief notification — caps it to 1/day. */
  lastBriefDate?: string;
}

/** Local calendar date as YYYY-MM-DD, used to cap the brief notification to 1/day. */
function todayKey(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function hasChrome(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.notifications && !!chrome.storage?.local;
}

async function getBool(key: string, def: boolean): Promise<boolean> {
  const v = (await chrome.storage.local.get(key))[key];
  return typeof v === 'boolean' ? v : def;
}

async function getState(): Promise<NotifyState> {
  const v = (await chrome.storage.local.get(STORAGE_KEYS.notifyState))[STORAGE_KEYS.notifyState];
  return (v && typeof v === 'object' ? v : {}) as NotifyState;
}

async function setState(next: NotifyState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.notifyState]: next });
}

function iconUrl(): string {
  try {
    return chrome.runtime.getURL('icons/icon128.png');
  } catch {
    return '';
  }
}

function create(id: string, title: string, message: string): void {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: iconUrl(),
    title,
    message,
    priority: 1,
  });
}

/**
 * Fire scan-completion notifications when opted in. Safe to call on every scan —
 * gated on the opt-in flag + kill switch, and deduped by content signature so a
 * re-scan that finds the same things stays quiet.
 */
export async function notifyScanResults(
  decisions: Decision[],
  groups: ClutterSenderGroup[]
): Promise<void> {
  if (!hasChrome()) return;
  try {
    const enabled = await getBool(STORAGE_KEYS.notifyEnabled, false);
    if (!enabled) return;
    const killed = await getBool(STORAGE_KEYS.killSwitch, DEFAULTS.killSwitch);
    if (killed) return;

    // Per-category opt-out — both default ON when the master switch is on.
    const decisionsOn = await getBool(STORAGE_KEYS.notifyDecisions, true);
    const clutterOn = await getBool(STORAGE_KEYS.notifyClutter, true);

    const state = await getState();
    const next: NotifyState = { ...state };

    // 1) High-priority decisions — these ARE today's brief, so this doubles as
    //    the "daily brief ready" nudge. Deduped by content signature AND capped
    //    at most once per calendar day so a few same-day rescans stay quiet.
    const today = todayKey();
    const high = decisions.filter(
      (d) => !d.demoted && (d.urgency === 'critical' || d.urgency === 'high')
    );
    const decisionSig = high
      .map((d) => d.id)
      .sort()
      .join(',');
    if (
      decisionsOn &&
      high.length > 0 &&
      decisionSig !== state.lastDecisionSig &&
      state.lastBriefDate !== today
    ) {
      const lead = high[0]?.title ?? 'Something needs you';
      const more = high.length > 1 ? ` +${high.length - 1} more` : '';
      create(
        NOTIFY_ID_DECISIONS,
        high.length === 1 ? '1 thing needs you today' : `${high.length} things need you today`,
        `${lead}${more}`
      );
      next.lastDecisionSig = decisionSig;
      next.lastBriefDate = today;
    }

    // 2) Unsubscribe batch ready.
    const unsubReady = groups.filter((g) => g.suggestedActions?.includes('unsubscribe'));
    const clutterSig = unsubReady
      .map((g) => g.senderDomain)
      .sort()
      .join(',');
    if (
      clutterOn &&
      unsubReady.length >= DEFAULTS.notifyUnsubBatchMin &&
      clutterSig !== state.lastClutterSig
    ) {
      create(
        NOTIFY_ID_CLUTTER,
        `${unsubReady.length} senders ready to clean up`,
        'Open Cleanup to unsubscribe and clear them in a few clicks.'
      );
      next.lastClutterSig = clutterSig;
    }

    await setState(next);
  } catch (err) {
    // Notifications are a nicety — never let them break a scan.
    log.warn('notifyScanResults failed', err);
  }
}

/**
 * Wire notification clicks to open the side panel. Call once from the service
 * worker's top level. Best-effort: opening the side panel needs the click's user
 * gesture and a focused window.
 */
export function registerNotificationClicks(): void {
  if (typeof chrome === 'undefined' || !chrome.notifications?.onClicked) return;
  chrome.notifications.onClicked.addListener((id) => {
    if (id !== NOTIFY_ID_DECISIONS && id !== NOTIFY_ID_CLUTTER) return;
    void (async () => {
      try {
        chrome.notifications.clear(id);
        const win = await chrome.windows.getLastFocused();
        if (win?.id !== undefined && chrome.sidePanel?.open) {
          await chrome.sidePanel.open({ windowId: win.id });
        }
      } catch (err) {
        log.warn('notification click open failed', err);
      }
    })();
  });
}
