import {
  EmailCandidate,
  EmailCandidateSchema,
  ScanResult,
  ScanResultSchema,
} from '@schemas/index';
import { DEFAULTS } from '@/common/constants';
import { log } from '@/common/log';
import type { EmailProvider } from './types';

/**
 * Outlook (OWA) DOM scanner. Mirrors `gmail.ts`: reads whatever is currently
 * visible in the user's Outlook Web tab. No OAuth, no Microsoft Graph — the
 * existing signed-in browser session is the auth.
 *
 * OWA serves the same SPA under three hosts:
 *  - outlook.live.com         (consumer)
 *  - outlook.office.com       (Microsoft 365)
 *  - outlook.office365.com    (Microsoft 365)
 *
 * Contract (see `types.ts`): every selector failure is wrapped in try/catch
 * and the scanner returns a partial result with `warnings` rather than
 * throwing — half a result is more useful than none. OWA's class names are
 * obfuscated and regenerated on each deploy, so we lean exclusively on
 * `role`/`aria-*`/`data-*` attributes that have been stable for years.
 */

// Message-list rows. Across OWA versions every row in the message list is a
// `div[role="option"]` with a non-empty aria-label that encodes the row's
// human description ("Sender. Subject. Snippet. Time. Read/Unread.").
const ROW_SELECTOR = 'div[role="option"][aria-label]';

// The aria-label on a flagged/pinned row contains "Flagged" or "Pinned".
const STARRED_RE = /\b(flagged|pinned)\b/i;
// Unread state — present in the aria-label as ", Unread" or "Unread,".
const UNREAD_RE = /\bunread\b/i;
// "Has attachment" hint — useful for attachmentsCount approximation.
const ATTACH_RE = /\b(has attachment|with attachment)/i;

// Open reading-pane (single message or expanded conversation). OWA renders
// each visible message inside `div[role="region"]` with a sub-element holding
// the sender chip and the body.
const READING_PANE = 'div[role="main"] div[role="region"], div[role="document"]';
const READING_MESSAGE = 'div[role="article"], article[role="article"]';

// Focused/Other inbox split. The selected tab is the active mailbox segment.
const PIVOT_TABS =
  '[role="tablist"] [role="tab"][aria-selected="true"], [role="tab"][aria-selected="true"]';

// Virtualized message list scroller — OWA does NOT paginate; the list is a
// windowed virtual scroller. We scroll it to load more rows.
const LIST_SCROLLER =
  'div[role="region"][aria-label*="Message list" i], ' +
  'div[role="region"][aria-label*="Messages" i], ' +
  'div[role="grid"][aria-label*="Messages" i]';

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function senderDomain(addr: string): string {
  const m = addr.match(/@([^>\s]+)/);
  return (m?.[1] ?? '').toLowerCase();
}

function findUnsubscribeLinks(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll('a'))
    .filter((a) => /unsubscribe|opt[\s-]?out|email preferences/i.test(a.textContent ?? ''))
    .map((a) => a.href)
    .filter((href) => /^https?:\/\//.test(href))
    .slice(0, 5);
}

const ACTION_EXCLUDE =
  /unsubscribe|opt[\s-]?out|email preferences|update preferences|manage (your )?(preferences|subscription)|privacy|terms|view (this )?(email )?(in|online|browser)|facebook|twitter|instagram|linked\s?in|youtube|tiktok|app\s?store|google\s?play/i;
const ACTION_PREFER =
  /\b(pay|view (your )?(receipt|invoice|order|booking|statement|details)|confirm|review|track(ing)?|download|complete|get started|sign in|log ?in|rsvp|approve|verify|reset|finish|continue|open)\b/i;

function findPrimaryActionLink(scope: ParentNode, unsubscribe: string[]): string | null {
  const unsubSet = new Set(unsubscribe);
  const scored = Array.from(scope.querySelectorAll('a'))
    .filter((a) => /^https?:\/\//.test(a.href) && !unsubSet.has(a.href))
    .map((a) => {
      const text = (a.textContent ?? '').trim();
      const cls = typeof a.className === 'string' ? a.className : '';
      if (ACTION_EXCLUDE.test(text) || ACTION_EXCLUDE.test(a.href)) return null;
      let score = 0;
      if (ACTION_PREFER.test(text)) score += 3;
      if (/btn|button|cta|action/i.test(cls)) score += 2;
      if (text.length > 0 && text.length <= 40) score += 1;
      if (text.length === 0) score -= 2;
      return { href: a.href, score };
    })
    .filter((x): x is { href: string; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score > 0 ? best.href : null;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * Best-effort parse of an OWA row's aria-label into structured fields. The
 * label is human-formatted and varies a little across OWA versions, but
 * follows a stable shape:
 *
 *   "<Sender name>. <Subject>. <Snippet>. <Date>. <Read/Unread state>."
 *
 * We extract the sender (first segment), the date (a segment that parses as a
 * Date), and unread/starred/attachment flags from regex hits on the whole
 * label. Subject + snippet are read from DOM children when available — they
 * carry richer text than the truncated aria-label.
 */
function parseRowAriaLabel(label: string): {
  senderName?: string;
  senderEmail?: string;
  receivedAt?: string;
  isUnread: boolean;
  isStarred: boolean;
  hasAttachment: boolean;
} {
  const parts = label.split(/[•,\.]\s+/).map((s) => s.trim()).filter(Boolean);
  let senderName: string | undefined;
  let senderEmail: string | undefined;
  let receivedAt: string | undefined;

  // First segment is usually the sender. If the sender chip embeds an address
  // it'll match the email regex; otherwise we keep it as the display name.
  if (parts.length > 0) {
    const first = parts[0]!;
    const m = first.match(EMAIL_RE);
    if (m) senderEmail = m[0];
    senderName = first.replace(EMAIL_RE, '').replace(/[<>]/g, '').trim() || undefined;
  }

  // Scan every segment for the first one that parses as an absolute date.
  for (const seg of parts) {
    if (!/\d/.test(seg)) continue; // dates contain digits
    const d = new Date(seg);
    if (!Number.isNaN(d.getTime())) {
      receivedAt = d.toISOString();
      break;
    }
  }

  return {
    senderName,
    senderEmail,
    receivedAt,
    isUnread: UNREAD_RE.test(label),
    isStarred: STARRED_RE.test(label),
    hasAttachment: ATTACH_RE.test(label),
  };
}

function buildRowSelector(row: HTMLElement, index: number): string {
  // OWA rows expose a stable conversation id (`data-convid`) on most versions
  // — when present, the most reliable selector. Fall back to data-itemid,
  // then to id, then to a positional :nth-of-type within the list scroller.
  const convId = row.getAttribute('data-convid');
  if (convId) return `div[role="option"][data-convid="${CSS.escape(convId)}"]`;
  const itemId = row.getAttribute('data-itemid');
  if (itemId) return `div[role="option"][data-itemid="${CSS.escape(itemId)}"]`;
  const id = row.getAttribute('id');
  if (id) return `#${CSS.escape(id)}`;
  return `div[role="option"]:nth-of-type(${index + 1})`;
}

/**
 * Read the active Inbox split (Focused vs Other) so synthesis has a clutter
 * signal — OWA's "Other" is roughly Gmail's Promotions/Updates. Anything we
 * can't determine is left as 'inbox'.
 */
function currentFolderLabel(): string | null {
  try {
    const sel = document.querySelector(PIVOT_TABS)?.textContent?.trim();
    if (!sel) return null;
    if (/focused/i.test(sel)) return 'focused';
    if (/other/i.test(sel)) return 'other';
    if (/inbox/i.test(sel)) return 'inbox';
    return sel.slice(0, 32).toLowerCase();
  } catch {
    return null;
  }
}

function extractRow(row: HTMLElement, idx: number, warnings: string[]): EmailCandidate | null {
  try {
    const label = row.getAttribute('aria-label') ?? '';
    const parsed = parseRowAriaLabel(label);

    // Subject: prefer a stable child with `role="heading"` or a span that
    // carries the long-form subject. Fall back to the aria-label's 2nd segment.
    const subjectEl =
      row.querySelector('[role="heading"], span[id$="Subject"], div[role="heading"]') ??
      row.querySelector('span[title]');
    const subjectFromDom = subjectEl?.textContent?.trim();
    const subjectFromLabel = label.split(/[•,\.]\s+/).slice(1, 2).join(' ').trim();
    const subject = subjectFromDom || subjectFromLabel || '';

    // Snippet: the row preview line. OWA places it in a span whose title
    // attribute holds the full text when truncated. Fall back to the 3rd
    // aria-label segment.
    const snippetEl = row.querySelector('span[title]:not([role="heading"])');
    const snippetFromDom = snippetEl?.getAttribute('title')?.trim() || snippetEl?.textContent?.trim();
    const snippetFromLabel = label.split(/[•,\.]\s+/).slice(2, 3).join(' ').trim();
    const snippet = (snippetFromDom || snippetFromLabel || '').slice(0, 200);

    // Sender email/name. OWA sometimes exposes the address only on the
    // open-thread sender chip (span[email]-like attribute is Gmail-only). When
    // a row gives us only a display name, we synthesize a synthetic local part
    // so the orchestrator can still group by sender — the synthetic local part
    // is stable across rescans because it derives from the display name only.
    let senderEmail = parsed.senderEmail ?? '';
    let senderName = parsed.senderName ?? '';
    if (!senderEmail) {
      // Inspect any <a href="mailto:..."> inside the row.
      const mail = (row.querySelector('a[href^="mailto:"]') as HTMLAnchorElement | null)?.href;
      const m = mail?.match(EMAIL_RE);
      if (m) senderEmail = m[0];
    }
    if (!senderEmail && senderName) {
      // Synthesize a deterministic pseudo-address: "<slug>@outlook.local".
      // Senders without a domain otherwise collide on '' across the scan,
      // which would let the synthesizer accidentally fold them together.
      const slug = senderName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.|\.$/g, '')
        .slice(0, 48) || 'sender';
      senderEmail = `${slug}@outlook.local`;
    }
    const from = senderEmail
      ? { name: senderName || undefined, email: senderEmail }
      : { email: 'unknown@outlook.local' };

    // IDs: prefer real conversation/item ids; fall back to a stable hash so a
    // re-scan still produces deterministic decision ids.
    const convId = row.getAttribute('data-convid') ?? row.getAttribute('data-conversationid');
    const itemId = row.getAttribute('data-itemid') ?? row.getAttribute('data-id');
    const idAttr =
      itemId ?? convId ?? hash(`${from.email}|${subject}|${snippet}|${idx}`);
    const threadId = convId ?? itemId ?? idAttr;

    const unsubLinks = findUnsubscribeLinks(row);
    const folder = currentFolderLabel();
    const labels: string[] = [];
    if (folder) labels.push(folder);
    if (parsed.hasAttachment) labels.push('attachment');

    // Build a thread locator we can re-open by URL fragment. OWA's reading
    // pane URL embeds the conversation/item id in the path's last segment;
    // the most portable form is `?ItemID=<id>` (works on consumer + M365).
    const threadLocator = convId
      ? `?ItemID=${encodeURIComponent(convId)}`
      : itemId
        ? `?ItemID=${encodeURIComponent(itemId)}`
        : null;

    return EmailCandidateSchema.parse({
      id: idAttr,
      threadId,
      provider: 'outlook',
      from,
      subject,
      snippet,
      bodyExcerpt: snippet, // row preview only; thread reader fills body
      isUnread: parsed.isUnread,
      isStarred: parsed.isStarred,
      labels,
      hasUnsubscribeLink: unsubLinks.length > 0,
      unsubscribeLinkHrefs: unsubLinks,
      attachmentsCount: parsed.hasAttachment ? 1 : 0,
      ...(threadLocator ? { threadLocator } : {}),
      domAnchor: { rowSelector: buildRowSelector(row, idx) },
      ...(parsed.receivedAt ? { receivedAt: parsed.receivedAt } : {}),
    });
  } catch (err) {
    warnings.push(`outlook row ${idx}: ${(err as Error).message}`);
    return null;
  }
}

export async function scanOutlookDom(
  source: 'inbox' | 'search' | 'thread'
): Promise<ScanResult> {
  const warnings: string[] = [];
  const candidates: EmailCandidate[] = [];

  if (source === 'thread') {
    candidates.push(...readOpenThread(warnings));
  } else {
    const rows = Array.from(document.querySelectorAll(ROW_SELECTOR)) as HTMLElement[];
    if (rows.length === 0) {
      warnings.push('No Outlook message rows found. Is Outlook finished loading?');
    }
    rows.slice(0, DEFAULTS.maxCandidatesPerScan).forEach((row, idx) => {
      const c = extractRow(row, idx, warnings);
      if (c) candidates.push(c);
    });
  }

  const scan: ScanResult = ScanResultSchema.parse({
    provider: 'outlook',
    scannedAt: new Date().toISOString(),
    source,
    pageUrl: location.href,
    candidates,
    threads: [],
    warnings,
  });
  log.info('outlook scan', { count: candidates.length, warnings: warnings.length });
  return scan;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait until message-list rows exist (OWA builds its DOM async after load). */
async function waitForRows(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (document.querySelector(ROW_SELECTOR)) return true;
    await sleep(150);
  }
  return !!document.querySelector(ROW_SELECTOR);
}

function pageFingerprint(): string {
  const rows = Array.from(document.querySelectorAll(ROW_SELECTOR)) as HTMLElement[];
  const parts = rows.map((r) => r.getAttribute('aria-label') ?? '');
  return `${rows.length}:${hash(parts.join('§'))}`;
}

/**
 * Find the scrollable container that owns the virtualized message list. We
 * try the labelled scroller first, then walk up from the first row looking
 * for an element with `overflow:auto/scroll`.
 */
function findListScroller(): HTMLElement | null {
  const named = document.querySelector(LIST_SCROLLER) as HTMLElement | null;
  if (named) return named;
  const firstRow = document.querySelector(ROW_SELECTOR) as HTMLElement | null;
  let el: HTMLElement | null = firstRow?.parentElement ?? null;
  let hops = 0;
  while (el && hops++ < 8) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Paginated inbox scan for Outlook. OWA virtualizes the list (no "Older"
 * button), so to grow the visible row set we scroll the message-list
 * container to the bottom and wait for the row count / fingerprint to grow.
 * Capped at `deepScanMaxPages` "scrolls" and stops the moment a scroll
 * doesn't bring in new rows — i.e. we've hit the end (or the user is offline).
 */
export async function scanOutlookInboxPaginated(
  target: number,
  onProgress?: (loaded: number) => void
): Promise<ScanResult> {
  const warnings: string[] = [];
  const byId = new Map<string, EmailCandidate>();

  if (!(await waitForRows(DEFAULTS.rowsAppearTimeoutMs))) {
    warnings.push('No Outlook message rows found. Is Outlook finished loading?');
    return ScanResultSchema.parse({
      provider: 'outlook',
      scannedAt: new Date().toISOString(),
      source: 'inbox',
      pageUrl: location.href,
      candidates: [],
      threads: [],
      warnings,
    });
  }

  const scroller = findListScroller();
  if (!scroller) {
    warnings.push('Could not locate the Outlook message-list scroller — scanning visible rows only.');
  }

  // First pass: harvest what's currently rendered.
  let idx = 0;
  const harvest = () => {
    const rows = Array.from(document.querySelectorAll(ROW_SELECTOR)) as HTMLElement[];
    for (const row of rows) {
      const c = extractRow(row, idx++, warnings);
      if (c && !byId.has(c.id)) byId.set(c.id, c);
    }
  };
  harvest();
  onProgress?.(byId.size);

  // Subsequent passes: scroll, wait for the list to grow, harvest again.
  for (let page = 0; page < DEFAULTS.deepScanMaxPages && byId.size < target; page++) {
    if (!scroller) break;
    const prevFp = pageFingerprint();
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });

    const deadline = Date.now() + DEFAULTS.pageSettleTimeoutMs;
    let advanced = false;
    while (Date.now() < deadline) {
      await sleep(200);
      const fp = pageFingerprint();
      if (fp !== prevFp) {
        advanced = true;
        break;
      }
    }
    if (!advanced) {
      warnings.push(
        `Outlook list stopped growing at page ${page + 1} (${byId.size} rows). End of inbox or list virtualization stuck.`
      );
      break;
    }
    harvest();
    onProgress?.(byId.size);
    await sleep(DEFAULTS.interPageDelayMs);
  }

  const candidates = Array.from(byId.values()).slice(0, target);
  const scan = ScanResultSchema.parse({
    provider: 'outlook',
    scannedAt: new Date().toISOString(),
    source: 'inbox',
    pageUrl: location.href,
    candidates,
    threads: [],
    warnings,
  });
  log.info('outlook paginated scan', { count: candidates.length, warnings: warnings.length });
  return scan;
}

function readOpenThread(warnings: string[]): EmailCandidate[] {
  const container = document.querySelector(READING_PANE);
  if (!container) {
    warnings.push('No open Outlook thread detected.');
    return [];
  }
  const messages = Array.from(container.querySelectorAll(READING_MESSAGE)) as HTMLElement[];
  // Some OWA layouts render a single message as the reading-pane root itself.
  const targets = messages.length > 0 ? messages : [container as HTMLElement];

  return targets
    .map((msg, idx) => {
      try {
        // Sender chip — OWA exposes it as a button with aria-label, the email
        // address sometimes embedded in a title attribute on a child <span>.
        const senderEl =
          msg.querySelector('[role="button"][aria-label*="@"]') ??
          msg.querySelector('span[title*="@"]') ??
          msg.querySelector('a[href^="mailto:"]');
        const senderLabel =
          senderEl?.getAttribute('aria-label') ??
          senderEl?.getAttribute('title') ??
          senderEl?.textContent ??
          '';
        const emailMatch = senderLabel.match(EMAIL_RE);
        const senderEmail = emailMatch?.[0] ?? '';
        const senderName = senderLabel
          .replace(EMAIL_RE, '')
          .replace(/[<>()]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        const subject =
          document.querySelector('[role="heading"][aria-level="1"], h1, h2[role="heading"]')
            ?.textContent?.trim() ?? '';

        // Body — OWA renders the visible message body inside `div[role="document"]`
        // or `div[id^="UniqueMessageBody"]`. Fall back to whatever long text
        // we can find inside the message container.
        const bodyEl =
          msg.querySelector('div[role="document"]') ??
          msg.querySelector('[id^="UniqueMessageBody"], [id*="MessageBody"]') ??
          msg;
        const bodyText = (bodyEl.textContent ?? '').trim().slice(0, DEFAULTS.bodyExcerptChars);

        const unsubLinks = findUnsubscribeLinks(msg);
        const actionUrl = findPrimaryActionLink(bodyEl, unsubLinks);

        // Date — OWA renders it in a span with a title attribute holding the
        // full absolute date (e.g. "Fri 3/5/2026 10:42 AM").
        const dateEl = msg.querySelector('span[title]');
        const dateTitle = dateEl?.getAttribute('title')?.trim();
        let receivedAt: string | undefined;
        if (dateTitle) {
          const d = new Date(dateTitle);
          if (!Number.isNaN(d.getTime())) receivedAt = d.toISOString();
        }

        const from = senderEmail
          ? { name: senderName || undefined, email: senderEmail }
          : { email: senderName || 'unknown@outlook.local' };

        // The open thread IS the current OWA view — preserve the query/hash
        // so a re-open round-trips to the same conversation.
        const threadLocator = location.search || location.hash || null;
        const itemId =
          msg.getAttribute('data-convid') ?? msg.getAttribute('data-itemid') ?? msg.getAttribute('id');
        const threadRowSelector = itemId
          ? msg.hasAttribute('data-convid')
            ? `div[role="option"][data-convid="${CSS.escape(itemId)}"]`
            : `#${CSS.escape(itemId)}`
          : null;

        return EmailCandidateSchema.parse({
          id: hash(`${from.email}|${subject}|${idx}|${bodyText.slice(0, 64)}`),
          threadId: hash(subject || from.email),
          provider: 'outlook',
          from,
          subject,
          snippet: bodyText.slice(0, 200),
          bodyExcerpt: bodyText,
          hasUnsubscribeLink: unsubLinks.length > 0,
          unsubscribeLinkHrefs: unsubLinks,
          ...(actionUrl ? { actionUrl } : {}),
          ...(threadLocator ? { threadLocator } : {}),
          ...(receivedAt ? { receivedAt } : {}),
          ...(threadRowSelector ? { domAnchor: { rowSelector: threadRowSelector } } : {}),
        });
      } catch (err) {
        warnings.push(`outlook thread msg ${idx}: ${(err as Error).message}`);
        return null;
      }
    })
    .filter((c): c is EmailCandidate => c !== null);
}

export function getSenderDomain(c: EmailCandidate): string {
  return senderDomain(c.from.email) || c.from.email.toLowerCase();
}

export const OutlookProvider: EmailProvider = {
  id: 'outlook',
  scan: scanOutlookDom,
  readOpenThread: async () => readOpenThread([]),
};
