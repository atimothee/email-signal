import type { EmailAddress } from '@schemas/index';

/**
 * Smart sender-name resolution.
 *
 * The Gmail DOM frequently gives us only a machine address ("noreply@omig.co.za")
 * or a generic role mailbox ("statements@absa.co.za"). Showing the user
 * "noreply" tells them nothing — they want to know *who* the mail is from.
 *
 * `resolveSenderName` returns a human-friendly brand or person name:
 *   - a real display name when one is present and looks human/brand-like
 *   - otherwise a brand derived from the registrable domain
 *     ("marketing.acme.com" -> "Acme", "absa.co.za" -> "Absa")
 *
 * Used by the sidecar when hydrating decisions and clutter findings, so no
 * surface ever renders "noreply" or a raw address.
 */

/** Local-parts that carry no identity — never show these to the user. */
const GENERIC_LOCAL_PARTS = new Set([
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply',
  'notifications', 'notification', 'notify', 'mailer', 'mailer-daemon', 'postmaster',
  'news', 'newsletter', 'updates', 'update', 'alerts', 'alert', 'account', 'accounts',
  'billing', 'statements', 'statement', 'mail', 'email', 'admin', 'contact', 'help',
  'service', 'services', 'automated', 'auto', 'bounce', 'noreply-dev', 'reply',
  'hello', 'team', 'info', 'support', 'care', 'message', 'messages',
]);

/** Domains where the brand name isn't obvious from the registrable label. */
const KNOWN_BRANDS: Record<string, string> = {
  'att.com': 'AT&T',
  'stripe.com': 'Stripe',
  'substack.com': 'Substack',
  'united.com': 'United Airlines',
  'absa.co.za': 'Absa',
  'absa.africa': 'Absa',
  'omig.co.za': 'OMIG',
  'oldmutual.com': 'Old Mutual',
  'google.com': 'Google',
  'accounts.google.com': 'Google',
  'github.com': 'GitHub',
  'paypal.com': 'PayPal',
  'amazon.com': 'Amazon',
  'apple.com': 'Apple',
  'microsoft.com': 'Microsoft',
  'linkedin.com': 'LinkedIn',
  'netflix.com': 'Netflix',
  'uber.com': 'Uber',
  'slack.com': 'Slack',
  'notion.so': 'Notion',
  'fnb.co.za': 'FNB',
  'standardbank.co.za': 'Standard Bank',
  'nedbank.co.za': 'Nedbank',
  'capitecbank.co.za': 'Capitec',
};

/** Two-label public suffixes we must drop entirely to find the org label. */
const MULTI_LABEL_TLDS = new Set([
  'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.in', 'co.ke',
  'com.br', 'com.mx', 'com.sg', 'com.hk', 'co.jp', 'com.tr',
]);

export function domainOf(email: string): string {
  const m = email.match(/@([^>\s]+)/);
  return (m?.[1] ?? '').toLowerCase().trim();
}

function titleCase(label: string): string {
  return label
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Best-effort brand name from a domain ("marketing.acme.com" -> "Acme"). */
export function brandFromDomain(domain: string): string {
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (!d) return '';
  if (KNOWN_BRANDS[d]) return KNOWN_BRANDS[d]!;

  const parts = d.split('.').filter(Boolean);
  if (parts.length <= 1) return titleCase(parts[0] ?? d);

  const lastTwo = parts.slice(-2).join('.');
  // Registrable label sits before the public suffix.
  const orgIndex = MULTI_LABEL_TLDS.has(lastTwo) ? parts.length - 3 : parts.length - 2;
  const org = parts[orgIndex] ?? parts[0]!;
  return titleCase(org);
}

function localPartOf(email: string): string {
  const at = email.indexOf('@');
  return (at > 0 ? email.slice(0, at) : email).toLowerCase().trim();
}

/** A name is "generic" when it gives the user no identity signal. */
function isGenericName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (n.includes('@')) return true; // it's an address, not a name
  if (GENERIC_LOCAL_PARTS.has(n.replace(/\s+/g, ''))) return true;
  if (/^(no.?reply|do.?not.?reply|donotreply|mailer|postmaster|notifications?)/.test(n)) return true;
  return false;
}

/**
 * Resolve a friendly sender name. Always returns something a human recognizes —
 * never "noreply", never a bare email address.
 */
export function resolveSenderName(from: EmailAddress, domainHint?: string): string {
  const domain = (domainHint ?? domainOf(from.email)).toLowerCase();
  const rawName = from.name?.trim() ?? '';

  if (rawName && !isGenericName(rawName)) return rawName;

  // No usable name — derive from the address.
  const local = localPartOf(from.email);
  if (local && !GENERIC_LOCAL_PARTS.has(local.replace(/[-_.]/g, '')) && !/^\d+$/.test(local) && !domain) {
    return titleCase(local);
  }

  const brand = brandFromDomain(domain);
  if (brand) return brand;
  return rawName || from.email || 'Unknown sender';
}
