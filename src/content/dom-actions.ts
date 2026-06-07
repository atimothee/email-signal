import type { ProposedAction } from '@schemas/index';
import { applyHighlight, removeHighlight } from './highlighter';
import { log } from '@/common/log';

interface DomResult {
  ok: boolean;
  error?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

const GMAIL_ROW = 'tr.zA';

/**
 * Dispatch a full mouse-event sequence. Gmail's controls are wired via its
 * `jsaction` framework, which reacts to mousedown/mouseup — a bare
 * element.click() fires only a synthetic `click` and is silently ignored. This
 * was the actual cause of "Mute checks the row but never marks it read": the
 * checkbox toggled visually but Gmail never registered the selection, so the
 * "Mark as read" toolbar button never appeared (#72).
 */
function realClick(el: HTMLElement): void {
  const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll `fn` until it returns a truthy value or the timeout elapses. */
async function waitFor<T>(fn: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= deadline) return fn();
    await sleep(50);
  }
}

/**
 * Locate a Gmail row for an action. Prefers the stable `messageId`
 * (data-legacy-message-id) so the row is found by IDENTITY in the user's real
 * tab — the positional `rowSelector` was resolved in the disposable scan tab and
 * rarely re-resolves here (#72). Falls back to `rowSelector` for callers (and
 * providers) that only supplied one.
 */
function resolveRow(params: Record<string, unknown>): HTMLElement | null {
  const messageId = params['messageId'];
  if (typeof messageId === 'string' && messageId) {
    const hit = document.querySelector(
      `[data-legacy-message-id="${CSS.escape(messageId)}"]`
    ) as HTMLElement | null;
    if (hit) return (hit.closest(GMAIL_ROW) as HTMLElement | null) ?? hit;
  }
  const sel = params['rowSelector'];
  if (typeof sel === 'string' && sel) return document.querySelector(sel) as HTMLElement | null;
  return null;
}

/**
 * First visible toolbar button whose data-tooltip OR aria-label contains one of
 * `needles` (case-insensitive). Gmail labels this control inconsistently across
 * locales/layouts (sometimes data-tooltip, sometimes aria-label), so the old
 * exact `data-tooltip="Mark as read"` match failed in many real inboxes (#72).
 */
function findToolbarButton(needles: string[]): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll('[role="button"]')) as HTMLElement[];
  for (const b of buttons) {
    const label = (b.getAttribute('data-tooltip') ?? b.getAttribute('aria-label') ?? '').toLowerCase();
    if (!label) continue;
    if (!needles.some((n) => label.includes(n))) continue;
    const rect = b.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue; // not rendered
    return b;
  }
  return null;
}

/**
 * Executes a single user-APPROVED ProposedAction against the Gmail DOM.
 * This function only runs AFTER ActionPolicyAgent + user approval — it
 * assumes consent and does not double-check.
 *
 * Safety rules:
 *  - Never deletes emails.
 *  - Never sends emails.
 *  - Never enters credentials or payment details on any popped-up page.
 *  - For unsubscribe clicks we open the href in a new tab so the user can
 *    confirm visually; we do not run any JS on the destination page.
 */
export async function executeProposedAction(action: ProposedAction): Promise<DomResult> {
  try {
    switch (action.type) {
      case 'highlight_element': {
        const sel = (action.params['selector'] as string) ?? '';
        if (!sel) return { ok: false, error: 'missing selector' };
        applyHighlight(sel);
        setTimeout(() => removeHighlight(sel), 6000);
        return { ok: true };
      }
      case 'scroll_to_element': {
        const sel = (action.params['selector'] as string) ?? '';
        const el = document.querySelector(sel);
        if (!el) return { ok: false, error: 'selector not found' };
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { ok: true };
      }
      case 'open_email': {
        const row = resolveRow(action.params);
        if (!row) return { ok: false, error: 'row not found' };
        realClick(row);
        return { ok: true };
      }
      case 'click_unsubscribe': {
        const href = (action.params['unsubscribeHref'] as string) ?? '';
        if (!href || !/^https?:\/\//.test(href)) {
          return { ok: false, error: 'invalid unsubscribe href' };
        }
        // Open in a new tab so user can observe what the destination does.
        // We do NOT submit forms or auto-confirm on the landing page.
        window.open(href, '_blank', 'noopener,noreferrer');
        return { ok: true, after: { openedHref: href } };
      }
      case 'mark_read': {
        const row = resolveRow(action.params);
        if (!row) return { ok: false, error: 'row not found' };
        // Inbox rows mark unread with the `zE` class. If it's already read,
        // there's nothing to do — short-circuit so the toast doesn't over-count.
        // (Only meaningful for inbox rows; a thread-view message element has no
        // such class, so we fall through and let the toolbar path handle it.)
        if (row.matches(GMAIL_ROW) && !row.classList.contains('zE')) {
          return { ok: true, after: { alreadyRead: true } };
        }
        // Gmail's "Mark as read" control only appears in the selection toolbar
        // once a row is selected. Select via the checkbox with a REAL mouse
        // sequence (a bare .click() doesn't trip Gmail's jsaction), wait for the
        // toolbar button to appear, then click it.
        const checkbox = row.querySelector('div[role="checkbox"]') as HTMLElement | null;
        if (!checkbox) return { ok: false, error: 'row checkbox not found' };
        realClick(checkbox);
        const markBtn = await waitFor(() => findToolbarButton(['mark as read']), 1500);
        if (!markBtn) {
          // Don't leave the row selected if we couldn't complete the action.
          realClick(checkbox);
          return { ok: false, error: 'mark-as-read control not found' };
        }
        realClick(markBtn);
        return { ok: true, after: { marked: true } };
      }
      case 'archive': {
        const row = resolveRow(action.params);
        if (!row) return { ok: false, error: 'row not found' };
        // Prefer the per-row hover Archive button; fall back to selecting the row
        // and using the selection toolbar's Archive control.
        const rowBtn = Array.from(row.querySelectorAll('[role="button"]')).find(
          (b) => /archive/i.test(b.getAttribute('data-tooltip') ?? b.getAttribute('aria-label') ?? '')
        ) as HTMLElement | undefined;
        if (rowBtn) {
          realClick(rowBtn);
          return { ok: true, after: { archived: true } };
        }
        const checkbox = row.querySelector('div[role="checkbox"]') as HTMLElement | null;
        if (!checkbox) return { ok: false, error: 'row checkbox not found' };
        realClick(checkbox);
        const archiveBtn = await waitFor(() => findToolbarButton(['archive']), 1500);
        if (!archiveBtn) {
          realClick(checkbox);
          return { ok: false, error: 'archive control not found' };
        }
        realClick(archiveBtn);
        return { ok: true, after: { archived: true } };
      }
      case 'apply_label':
      case 'suggest_label': {
        // V1: we don't programmatically open the label menu — it's brittle.
        // We highlight the email and surface a hint so the user can apply
        // the label themselves.
        const sel = (action.params['rowSelector'] as string) ?? '';
        if (sel) applyHighlight(sel);
        return { ok: true, after: { hint: 'highlighted for manual labeling' } };
      }
      case 'find_unsubscribe_link': {
        // Discovery action — no DOM mutation. Look for unsubscribe links in
        // the currently-open thread.
        const links = Array.from(document.querySelectorAll('a')).filter((a) =>
          /unsubscribe|opt[\s-]?out|email preferences/i.test(a.textContent ?? '')
        );
        return {
          ok: true,
          after: {
            found: links.length,
            hrefs: links.map((a) => a.href).slice(0, 5),
          },
        };
      }
      case 'remember_preference': {
        // Memory writes happen in the background; content script no-op.
        return { ok: true };
      }
      default:
        return { ok: false, error: `unsupported action type ${action.type}` };
    }
  } catch (err) {
    log.error('executeProposedAction failed', err);
    return { ok: false, error: (err as Error).message };
  }
}
