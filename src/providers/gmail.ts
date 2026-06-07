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
const SUBJECT_SELECTOR = '.bog, .y6 span'; // subject text in rows
const SENDER_SELECTOR = '.yW span[email], .yW span';
const SNIPPET_SELECTOR = '.y2';
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

/** Find the nearest scrollable ancestor that actually scrolls the inbox list. */
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const scrollable = /(auto|scroll)/.test(style.overflowY);
    if (scrollable && node.scrollHeight > node.clientHeight + 40) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? null;
}

/**
 * Deep inbox scan: Gmail virtualizes rows (off-screen rows leave the DOM), so a
 * single pass only sees ~50. We scroll the list in steps, accumulating unique
 * candidates by id, until we reach `target` or the list stops growing — then
 * restore the user's original scroll position. Progress is reported via
 * `onProgress` so the side panel can show "Reading 320/500…".
 */
export async function scanGmailInboxDeep(
  target: number,
  onProgress?: (loaded: number) => void
): Promise<ScanResult> {
  const warnings: string[] = [];
  const byId = new Map<string, EmailCandidate>();

  const firstRow = document.querySelector(ROW_SELECTOR) as HTMLElement | null;
  if (!firstRow) {
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

  const scroller = findScrollContainer(firstRow);
  const startTop = scroller?.scrollTop ?? 0;
  let idx = 0;
  let stagnant = 0;

  try {
    for (let i = 0; i < DEFAULTS.deepScanMaxScrolls; i++) {
      const rows = Array.from(document.querySelectorAll(ROW_SELECTOR)) as HTMLElement[];
      const before = byId.size;
      for (const row of rows) {
        const c = extractRow(row, idx++, warnings);
        if (c && !byId.has(c.id)) byId.set(c.id, c);
      }
      onProgress?.(byId.size);

      if (byId.size >= target) break;
      if (byId.size === before) {
        if (++stagnant >= 3) break; // list isn't growing — we've hit the end
      } else {
        stagnant = 0;
      }
      if (!scroller) break;

      const prevTop = scroller.scrollTop;
      scroller.scrollTop = Math.min(
        scroller.scrollHeight,
        scroller.scrollTop + Math.max(200, scroller.clientHeight * 0.9)
      );
      if (scroller.scrollTop === prevTop && byId.size === before) {
        if (++stagnant >= 3) break;
      }
      await sleep(280); // let Gmail render the next window of rows
    }
  } finally {
    if (scroller) scroller.scrollTop = startTop; // put the user back where they were
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
  log.info('gmail deep scan', { count: candidates.length, warnings: warnings.length });
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
