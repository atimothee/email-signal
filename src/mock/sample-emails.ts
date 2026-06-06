import { EmailCandidate, EmailCandidateSchema, ScanResult } from '@schemas/index';

/** Deterministic fixture used for tests, evals, and the "Mock mode" toggle. */
function mk(
  id: string,
  from: { name?: string; email: string },
  subject: string,
  snippet: string,
  extras: Partial<EmailCandidate> = {}
): EmailCandidate {
  return EmailCandidateSchema.parse({
    id,
    threadId: id,
    provider: 'gmail',
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
