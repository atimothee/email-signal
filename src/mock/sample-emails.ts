import { EmailCandidate, EmailCandidateSchema, Provider, ScanResult } from '@schemas/index';

/** Deterministic fixture used for tests, evals, and the "Mock mode" toggle. */
function mk(
  id: string,
  from: { name?: string; email: string },
  subject: string,
  snippet: string,
  extras: Partial<EmailCandidate> = {},
  provider: Provider = 'gmail'
): EmailCandidate {
  return EmailCandidateSchema.parse({
    id,
    threadId: id,
    provider,
    from,
    subject,
    snippet,
    bodyExcerpt: snippet,
    isUnread: true,
    ...extras,
  });
}

export const SAMPLE_CANDIDATES: EmailCandidate[] = [
  mk(
    'p1',
    { name: 'Acme Marketing', email: 'no-reply@marketing.acme.com' },
    '🎉 50% off everything this weekend',
    'Don\'t miss our biggest sale of the year. Shop the deals before midnight.',
    { hasUnsubscribeLink: true, unsubscribeLinkHrefs: ['https://acme.com/unsub?x=1'] }
  ),
  mk(
    'p2',
    { name: 'Acme Marketing', email: 'no-reply@marketing.acme.com' },
    'New arrivals just dropped',
    'Fresh styles for the season. Tap to browse.',
    { hasUnsubscribeLink: true, unsubscribeLinkHrefs: ['https://acme.com/unsub?x=2'] }
  ),
  mk(
    'b1',
    { name: 'AT&T Billing', email: 'billing@att.com' },
    'Your bill is due June 15',
    'Your statement of $84.32 is due on 2026-06-15. Pay online to avoid late fees.',
    { hasUnsubscribeLink: false }
  ),
  mk(
    'r1',
    { name: 'Maya Patel', email: 'maya@designcollab.co' },
    'Friday lunch?',
    'Hey! Are you free Friday for lunch near the office? Let me know.',
    { hasUnsubscribeLink: false }
  ),
  mk(
    'j1',
    { name: 'Anika at Stripe', email: 'anika@stripe.com' },
    'Engineering Manager role at Stripe',
    'Hi Timothy — I came across your profile and wanted to chat about an EM opening on our payments team. Let me know if you\'re open to a quick call.',
    { hasUnsubscribeLink: false }
  ),
  mk(
    'n1',
    { name: 'Substack Reads', email: 'digest@substack.com' },
    'Your weekly digest',
    'Three picks from writers you follow this week.',
    { hasUnsubscribeLink: true, unsubscribeLinkHrefs: ['https://substack.com/unsubscribe'] }
  ),
  mk(
    't1',
    { name: 'United Airlines', email: 'reservations@united.com' },
    'Check in for flight UA 832 (SFO → JFK) opens in 6 hours',
    'Online check-in opens at 8:00 PM PT. Seat 14A is reserved.',
    { hasUnsubscribeLink: false }
  ),
  mk(
    'f1',
    { name: 'Mom', email: 'mom@family.example' },
    'Call when you get a chance',
    'Just wanted to hear how things are going. Love you.',
    { hasUnsubscribeLink: false }
  ),
  // Outlook fixtures (#4 / #60). Real OWA-shaped candidates so evals cover the
  // second provider end-to-end — including the "Other" focused-inbox tag that
  // the Outlook scraper surfaces in `labels` and the `?ItemID=` thread locator
  // shape used to re-open conversations in the reading pane.
  mk(
    'o-pay-1',
    { name: 'Microsoft 365 billing', email: 'msft-noreply@microsoft.com' },
    'Your Microsoft 365 subscription renews on June 15',
    'Your annual subscription ($99.99) will auto-renew on 6/15/2026. Update payment if needed.',
    {
      hasUnsubscribeLink: false,
      labels: ['focused'],
      threadLocator: '?ItemID=AAQkADAwATM2Y2EzZDhh',
    },
    'outlook'
  ),
  mk(
    'o-cal-1',
    {
      name: 'Outlook Calendar',
      email: 'calendar-noreply@outlook.com',
    },
    'Accept: 1:1 with Priya — Tuesday 3:00 PM',
    'Priya invited you to a 30-minute meeting on Tue, Jun 9 at 3:00 PM. Tentative until you respond.',
    {
      hasUnsubscribeLink: false,
      labels: ['focused'],
      threadLocator: '?ItemID=AAQkADAwAcalfix',
    },
    'outlook'
  ),
  mk(
    'o-other-1',
    { name: 'LinkedIn Notifications', email: 'notifications-noreply@linkedin.com' },
    '5 new posts from people you follow',
    'Catch up on what your network shared this week. Updates from 3 connections.',
    {
      hasUnsubscribeLink: true,
      unsubscribeLinkHrefs: ['https://www.linkedin.com/comm/notifications/unsubscribe?x=1'],
      labels: ['other'],
      threadLocator: '?ItemID=AAQkADAwAlinkedin1',
    },
    'outlook'
  ),
];

export function makeMockScan(): ScanResult {
  return {
    provider: 'gmail',
    scannedAt: new Date().toISOString(),
    source: 'mock',
    candidates: SAMPLE_CANDIDATES,
    threads: [],
    warnings: [],
  };
}
