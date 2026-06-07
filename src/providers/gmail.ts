import {
  EmailCandidate,
  EmailCandidateSchema,
  ScanResult,
  ScanResultSchema,
} from '@schemas/index';
import { DEFAULTS } from '@/common/constants';
import { log } from '@/common/log';

/**
 * Gmail DOM scanner. Reads what is currently visible in the user's Gmail UI.
 *
 * IMPORTANT: Gmail's DOM is unstable. Every selector here is wrapped in a
 * try/catch and the scanner returns a partial result with warnings rather
 * than throwing — half a result is more useful than none.
 */

const ROW_SELECTOR = 'tr.zA'; // inbox rows
// Gmail's "Older" page-navigation arrow (next page of results). There can be
// more than one in the DOM; we pick the first enabled, visible one.
const OLDER_BUTTON_SELECTOR = '[aria-label="Older"], [data-tooltip="Older"]';
const SUBJECT_SELECTOR = '.bog, .y6 span'; // subject text in rows
const SENDER_SELECTOR = '.yW span[email], .yW span';
const SNIPPET_SELECTOR = '.y2';
// Inbox row date cell. Its TITLE attribute holds a full ABSOLUTE date like
// "Fri, Mar 3, 2026, 10:42 AM" (year + locale-formatted). The visible
// textContent ("10:42 AM", "Mar 3", "Yesterday") is relative/ambiguous — we
// read the title attr ONLY.
const DATE_SELECTOR = 'td.xW span[title], .xW span[title]';
const UNREAD_CLASS = 'zE';
const STARRED_SELECTOR = '.T-KT.aXw';

const OPEN_THREAD_CONTAINER = 'div[role="main"] div[role="list"]';
const OPEN_MESSAGE = 'div[role="listitem"]';

function hash(s: string): string {
  // tiny stable hash; not cryptographic — only needs to be deterministic.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function senderDomain(addr: string): string {
  const m = addr.match(/@([^>\s]+)/);
  return (m?.[1] ?? '').toLowerCase();
}

function extractAddress(el: Element | null): { name?: string; email: string } {
  if (!el) return { email: '' };
  const emailAttr = el.getAttribute('email');
  const name = el.getAttribute('name') ?? el.textContent?.trim() ?? '';
  return { name: name || undefined, email: emailAttr ?? name };
}

/**
 * Parse an absolute date from a span's `title` attribute (e.g.
 * "Fri, Mar 3, 2026, 10:42 AM") into an ISO string. Returns undefined if the
 * element/title is missing or the date is unparseable — we never guess, never
 * fall back to the relative textContent, and never throw (bad dates must not
 * sink a row; missing receivedAt is treated as RECENT downstream).
 */
function parseTitleDate(el: Element | null): string | undefined {
  const title = el?.getAttribute('title')?.trim();
  if (!title) return undefined;
  const d = new Date(title);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function findUnsubscribeLinks(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll('a'))
    .filter((a) => /unsubscribe|opt[\s-]?out|email preferences/i.test(a.textContent ?? ''))
    .map((a) => a.href)
    .filter((href) => /^https?:\/\//.test(href))
    .slice(0, 5);
}

function buildRowSelector(row: HTMLElement, index: number): string {
  // Build a positional selector we can re-resolve later. Gmail's row order
  // shifts when new mail arrives, so we also store the messageId.
  const idAttr = row.getAttribute('id');
  if (idAttr) return `#${CSS.escape(idAttr)}`;
  return `tr.zA:nth-of-type(${index + 1})`;
}

/** Extract a single inbox row into an EmailCandidate (null on failure). */
function extractRow(row: HTMLElement, idx: number, warnings: string[]): EmailCandidate | null {
  try {
    const subject = row.querySelector(SUBJECT_SELECTOR)?.textContent?.trim() ?? '';
    const senderEl = row.querySelector(SENDER_SELECTOR);
    const from = extractAddress(senderEl);
    const snippet = row.querySelector(SNIPPET_SELECTOR)?.textContent?.trim() ?? '';
    const isUnread = row.classList.contains(UNREAD_CLASS);
    const isStarred = !!row.querySelector(STARRED_SELECTOR);
    const receivedAt = parseTitleDate(row.querySelector(DATE_SELECTOR));
    const idAttr =
      row.getAttribute('data-legacy-message-id') ??
      row.getAttribute('data-legacy-thread-id') ??
      hash(`${from.email}|${subject}|${snippet}`);
    const threadAttr = row.getAttribute('data-legacy-thread-id') ?? idAttr;
    const unsubLinks = findUnsubscribeLinks(row);
    return EmailCandidateSchema.parse({
      id: idAttr,
      threadId: threadAttr,
      provider: 'gmail',
      from,
      subject,
      snippet,
      bodyExcerpt: snippet, // inbox rows don't expose body
      isUnread,
      isStarred,
      hasUnsubscribeLink: unsubLinks.length > 0,
      unsubscribeLinkHrefs: unsubLinks,
      domAnchor: { rowSelector: buildRowSelector(row, idx) },
      // Leave unset (not null) when unparseable so the schema's optional default
      // applies; missing receivedAt is treated as RECENT downstream.
      ...(receivedAt ? { receivedAt } : {}),
    });
  } catch (err) {
    warnings.push(`row ${idx}: ${(err as Error).message}`);
    return null;
  }
}

export async function scanGmailDom(
  source: 'inbox' | 'search' | 'thread'
): Promise<ScanResult> {
  const warnings: string[] = [];
  const candidates: EmailCandidate[] = [];

  if (source === 'thread') {
    candidates.push(...readOpenThread(warnings));
  } else {
    const rows = Array.from(document.querySelectorAll(ROW_SELECTOR)) as HTMLElement[];
    if (rows.length === 0) {
      warnings.push('No inbox rows found. Is Gmail finished loading?');
    }
    rows.slice(0, DEFAULTS.maxCandidatesPerScan).forEach((row, idx) => {
      const c = extractRow(row, idx, warnings);
      if (c) candidates.push(c);
    });
  }

  const scan: ScanResult = ScanResultSchema.parse({
    provider: 'gmail',
    scannedAt: new Date().toISOString(),
    source,
    pageUrl: location.href,
    candidates,
    threads: [],
    warnings,
  });
  log.info('gmail scan', { count: candidates.length, warnings: warnings.length });
  return scan;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Dispatch a full mouse-event sequence. Gmail's toolbar controls are wired via
 * its `jsaction` framework, which reacts to mousedown/mouseup — a bare
 * element.click() (which only fires a synthetic `click`) is ignored.
 */
function realClick(el: HTMLElement): void {
  const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

/** First enabled, on-screen "Older" page button, or null if none/disabled. */
function findOlderButton(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll(OLDER_BUTTON_SELECTOR)
  ) as HTMLElement[];
  for (const el of candidates) {
    if (el.getAttribute('aria-disabled') === 'true') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue; // not rendered
    return el;
  }
  return null;
}

/** Heuristic: Gmail is showing a rate-limit / unusual-activity interstitial. */
function looksRateLimited(): boolean {
  const text = (document.body?.innerText ?? '').slice(0, 4000).toLowerCase();
  return (
    text.includes('unusual activity') ||
    text.includes("we're sorry") ||
    text.includes('temporarily unable') ||
    text.includes('exceeded') && text.includes('limit')
  );
}

/** Wait until inbox rows exist (Gmail builds its DOM async after load). */
async function waitForRows(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (document.querySelector(ROW_SELECTOR)) return true;
    await sleep(150);
  }
  return !!document.querySelector(ROW_SELECTOR);
}

/**
 * A cheap fingerprint of the current page's rows (subject + sender text).
 * Robust to two things the real Gmail DOM showed us: rows expose no per-message
 * id attributes, and the first row's text starts with a constant "Important
 * because…" marker — so first-row identity is unreliable. Hashing ALL rows'
 * content changes cleanly between pages.
 */
function pageFingerprint(): string {
  const rows = Array.from(document.querySelectorAll(ROW_SELECTOR)) as HTMLElement[];
  const parts = rows.map(
    (r) =>
      (r.querySelector(SUBJECT_SELECTOR)?.textContent ?? '') +
      '|' +
      (r.querySelector(SENDER_SELECTOR)?.textContent ?? '')
  );
  return `${rows.length}:${hash(parts.join('§'))}`;
}

/**
 * Wait until the page advances after clicking "Older": the row fingerprint
 * changes (new page rendered). Returns false on timeout (page didn't move).
 */
async function waitForPageChange(prevFp: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fp = pageFingerprint();
    if (fp && fp !== prevFp && document.querySelector(ROW_SELECTOR)) return true;
    await sleep(150);
  }
  return false;
}

/**
 * Paginated inbox scan (Option B). Designed to run inside a disposable,
 * unfocused background Gmail tab: Gmail's web UI shows ~50 rows per page with
 * Older/Newer arrows (it does NOT infinite-scroll), so we extract the current
 * page, click "Older", wait for the next page to render, and repeat — paced to
 * stay under Gmail's rate limiting — until we reach `target`, run out of pages,
 * or hit a safety cap. Because the tab is throwaway we never restore position.
 */
export async function scanGmailInboxPaginated(
  target: number,
  onProgress?: (loaded: number) => void
): Promise<ScanResult> {
  const warnings: string[] = [];
  const byId = new Map<string, EmailCandidate>();

  if (!(await waitForRows(DEFAULTS.rowsAppearTimeoutMs))) {
    warnings.push('No inbox rows found. Is Gmail finished loading?');
    return ScanResultSchema.parse({
      provider: 'gmail',
      scannedAt: new Date().toISOString(),
      source: 'inbox',
      pageUrl: location.href,
      candidates: [],
      threads: [],
      warnings,
    });
  }

  let idx = 0;
  for (let page = 0; page < DEFAULTS.deepScanMaxPages; page++) {
    if (looksRateLimited()) {
      warnings.push('Gmail showed an unusual-activity page; stopped early to avoid a lockout.');
      break;
    }

    const rows = Array.from(document.querySelectorAll(ROW_SELECTOR)) as HTMLElement[];
    for (const row of rows) {
      const c = extractRow(row, idx++, warnings);
      if (c && !byId.has(c.id)) byId.set(c.id, c);
    }
    onProgress?.(byId.size);
    if (byId.size >= target) break;

    // Is there another page? Gmail disables "Older" on the last page.
    const older = findOlderButton();
    if (!older) {
      // No (enabled) Older button: either we've reached the end of the inbox,
      // or the selector missed. Flag the latter so it's debuggable.
      if (page === 0) {
        warnings.push('Could not find an enabled "Older" page button — pagination unavailable.');
      }
      break;
    }

    // The scan tab is focused (brief-focus hybrid). Advance with a full mouse
    // sequence on the "Older" arrow (Gmail's jsaction needs mousedown/mouseup,
    // not a bare click). If that doesn't take, fall back to hash navigation,
    // which can work now that the tab is visible.
    const prevFp = pageFingerprint();
    const half = Math.ceil(DEFAULTS.pageSettleTimeoutMs / 2);
    realClick(older);
    let advanced = await waitForPageChange(prevFp, half);
    if (!advanced) {
      const baseHash = (location.hash || '#inbox').replace(/\/p\d+$/, '');
      location.hash = `${baseHash}/p${page + 2}`;
      advanced = await waitForPageChange(prevFp, half);
    }
    if (!advanced) {
      warnings.push(
        `Stopped at page ${page + 1}: next page didn't load within ${DEFAULTS.pageSettleTimeoutMs}ms ` +
          `(visibility=${document.visibilityState}, rows=${document.querySelectorAll(ROW_SELECTOR).length}).`
      );
      break;
    }
    await sleep(DEFAULTS.interPageDelayMs); // human-paced; anti-rate-limit
  }

  const candidates = Array.from(byId.values()).slice(0, target);
  const scan = ScanResultSchema.parse({
    provider: 'gmail',
    scannedAt: new Date().toISOString(),
    source: 'inbox',
    pageUrl: location.href,
    candidates,
    threads: [],
    warnings,
  });
  log.info('gmail paginated scan', { count: candidates.length, warnings: warnings.length });
  return scan;
}

function readOpenThread(warnings: string[]): EmailCandidate[] {
  const container = document.querySelector(OPEN_THREAD_CONTAINER);
  if (!container) {
    warnings.push('No open thread detected.');
    return [];
  }
  const messages = Array.from(container.querySelectorAll(OPEN_MESSAGE)) as HTMLElement[];
  return messages
    .map((msg, idx) => {
      try {
        const headerEmailEl = msg.querySelector('span[email]');
        const from = extractAddress(headerEmailEl);
        const subject =
          document.querySelector('h2.hP')?.textContent?.trim() ?? '';
        const bodyEl = msg.querySelector('.a3s');
        const bodyText = (bodyEl?.textContent ?? '').trim().slice(0, DEFAULTS.bodyExcerptChars);
        const unsubLinks = findUnsubscribeLinks(msg);
        // Per-message header date span exposes a full absolute date in its
        // title. Best-effort: any span[title] inside the message header whose
        // title parses as a date; leave unset otherwise.
        const receivedAt = parseTitleDate(
          msg.querySelector(DATE_SELECTOR) ?? msg.querySelector('.g3 span[title], span.g3[title]')
        );
        return EmailCandidateSchema.parse({
          id: hash(`${from.email}|${subject}|${idx}|${bodyText.slice(0, 64)}`),
          threadId: hash(subject),
          provider: 'gmail',
          from,
          subject,
          snippet: bodyText.slice(0, 200),
          bodyExcerpt: bodyText,
          hasUnsubscribeLink: unsubLinks.length > 0,
          unsubscribeLinkHrefs: unsubLinks,
          ...(receivedAt ? { receivedAt } : {}),
        });
      } catch (err) {
        warnings.push(`thread msg ${idx}: ${(err as Error).message}`);
        return null;
      }
    })
    .filter((c): c is EmailCandidate => c !== null);
}

export function getSenderDomain(c: EmailCandidate): string {
  return senderDomain(c.from.email) || c.from.email.toLowerCase();
}

import type { EmailProvider } from './types';
export const GmailDomProvider: EmailProvider = {
  id: 'gmail',
  scan: scanGmailDom,
};
