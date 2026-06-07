import type { MailProvider } from '@schemas/index';

/**
 * Per-provider host match patterns. Kept in lock-step with
 * `public/manifest.json`'s `content_scripts.matches` + `host_permissions` —
 * if a host shows up here, the manifest MUST grant it (and vice versa) or the
 * service worker's `chrome.tabs.query({ url })` calls will silently miss it.
 *
 * The Outlook entry covers consumer (outlook.live.com) and the two M365 hosts
 * (outlook.office.com, outlook.office365.com). OWA serves the same SPA under
 * all three, so the scraper is identical.
 */
export const PROVIDER_MATCH_PATTERNS: Record<MailProvider, string[]> = {
  gmail: ['https://mail.google.com/*'],
  outlook: [
    'https://outlook.live.com/*',
    'https://outlook.office.com/*',
    'https://outlook.office365.com/*',
  ],
};

export const ALL_PROVIDER_MATCH_PATTERNS: string[] = [
  ...PROVIDER_MATCH_PATTERNS.gmail,
  ...PROVIDER_MATCH_PATTERNS.outlook,
];

/** Detect the provider from a tab URL. Returns null for non-mail tabs. */
export function providerFromUrl(url: string | undefined): MailProvider | null {
  if (!url) return null;
  if (url.startsWith('https://mail.google.com/')) return 'gmail';
  if (
    url.startsWith('https://outlook.live.com/') ||
    url.startsWith('https://outlook.office.com/') ||
    url.startsWith('https://outlook.office365.com/')
  ) {
    return 'outlook';
  }
  return null;
}

/**
 * A clean inbox URL for the same account as `srcUrl`. We scan from a fresh
 * inbox view so pagination/virtualization starts at the top. When `srcUrl`
 * doesn't carry account-index hints we default to the primary account.
 */
export function buildInboxUrl(provider: MailProvider, srcUrl: string | undefined): string {
  if (provider === 'gmail') {
    const m = srcUrl?.match(/mail\.google\.com\/mail\/u\/(\d+)/);
    const u = m?.[1] ?? '0';
    return `https://mail.google.com/mail/u/${u}/#inbox`;
  }
  // Outlook. Three flavors:
  //  - outlook.live.com  → /mail/0/inbox
  //  - outlook.office.com / outlook.office365.com → /mail/inbox
  // Stick to the SAME host the user is already signed in on; falling back to
  // the consumer host would force a re-auth on work/school accounts.
  if (srcUrl?.startsWith('https://outlook.live.com/')) {
    const m = srcUrl.match(/outlook\.live\.com\/mail\/(\d+)/);
    const u = m?.[1] ?? '0';
    return `https://outlook.live.com/mail/${u}/inbox/`;
  }
  if (srcUrl?.startsWith('https://outlook.office365.com/')) {
    return 'https://outlook.office365.com/mail/inbox';
  }
  if (srcUrl?.startsWith('https://outlook.office.com/')) {
    return 'https://outlook.office.com/mail/inbox';
  }
  // No usable srcUrl: pick the consumer host (it auto-redirects M365 accounts
  // signed into the SSO into the right place).
  return 'https://outlook.live.com/mail/0/inbox/';
}

/**
 * Default "new tab" URL for a provider — used by the side panel's "Connect an
 * inbox" CTA when no account has been detected yet. Lands on the provider's
 * root so the user picks the right account themselves.
 */
export function providerNewTabUrl(provider: MailProvider): string {
  return provider === 'outlook'
    ? 'https://outlook.live.com/mail/'
    : 'https://mail.google.com/';
}

/** Friendly provider label for user-facing strings. */
export const PROVIDER_LABEL: Record<MailProvider, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
};
