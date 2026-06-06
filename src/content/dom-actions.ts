import type { ProposedAction } from '@schemas/index';
import { applyHighlight, removeHighlight } from './highlighter';
import { log } from '@/common/log';

interface DomResult {
  ok: boolean;
  error?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
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
        const sel = (action.params['rowSelector'] as string) ?? '';
        const row = document.querySelector(sel) as HTMLElement | null;
        if (!row) return { ok: false, error: 'row not found' };
        row.click();
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
        const sel = (action.params['rowSelector'] as string) ?? '';
        const row = document.querySelector(sel) as HTMLElement | null;
        if (!row) return { ok: false, error: 'row not found' };
        // Gmail mark-as-read button (data-tooltip="Mark as read") only exists
        // when the row is selected. Click the row checkbox first.
        const checkbox = row.querySelector('div[role="checkbox"]') as HTMLElement | null;
        checkbox?.click();
        const markBtn = document.querySelector(
          'div[role="button"][data-tooltip="Mark as read"]'
        ) as HTMLElement | null;
        if (!markBtn) return { ok: false, error: 'mark-as-read button not visible' };
        markBtn.click();
        return { ok: true };
      }
      case 'archive': {
        const sel = (action.params['rowSelector'] as string) ?? '';
        const row = document.querySelector(sel) as HTMLElement | null;
        if (!row) return { ok: false, error: 'row not found' };
        const archiveBtn = row.querySelector(
          'div[role="button"][data-tooltip*="Archive"]'
        ) as HTMLElement | null;
        if (!archiveBtn) return { ok: false, error: 'archive button not visible on row' };
        archiveBtn.click();
        return { ok: true };
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
