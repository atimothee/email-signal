/**
 * Fully fictional demo content for the before → after centerpiece.
 *
 * No real names. No real PII. No real domains except the obviously generic
 * ones (gmail.com is implied by the surface).
 *
 * The "after" decisions are deliberately a SHORT list (3 items) plus a
 * single collapsed Cleanup line — never a re-skinned inbox.
 */

export type DemoEmail = {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  /** Bucket used by the collapse animation to route this row. */
  bucket: "decision-1" | "decision-2" | "decision-3" | "cleanup" | "past";
  receivedAt: string;
  unread?: boolean;
  important?: boolean;
  hasAttachment?: boolean;
  promo?: boolean;
};

export const DEMO_EMAILS: DemoEmail[] = [
  // --- The signal: real people, real money, real moments.
  {
    id: "e1",
    sender: "Dana Park",
    subject: "Re: Thursday call — does 2pm still work?",
    snippet: "Sorry to keep bumping this — want to lock in a time before Tuesday so I can…",
    bucket: "decision-1",
    receivedAt: "Tue 9:42 AM",
    unread: true,
  },
  {
    id: "e2",
    sender: "Dana Park",
    subject: "Re: Thursday call — does 2pm still work?",
    snippet: "Hey, just nudging this — happy to do 1:30 or 3pm too if 2 is tight.",
    bucket: "decision-1",
    receivedAt: "Yesterday",
    unread: true,
  },
  {
    id: "e3",
    sender: "ConEd Billing",
    subject: "FINAL NOTICE: Account balance due — $240.18",
    snippet: "Your account is now 14 days past due. To avoid service interruption…",
    bucket: "decision-2",
    receivedAt: "May 24",
    unread: true,
    important: true,
  },
  {
    id: "e4",
    sender: "Marisol — 219 Greene St",
    subject: "Apartment viewing — Saturday 2pm confirmation",
    snippet: "Hi! Just confirming you'd like to come by Saturday at 2pm. Buzzer is #4A…",
    bucket: "decision-3",
    receivedAt: "Wed 4:11 PM",
    unread: true,
  },

  // --- Cleanup: the satisfying sweep.
  { id: "c1", sender: "Substack Daily", subject: "📨 5 essays we think you'll love today", snippet: "From Anne Helen Petersen, Casey Newton, and three…", bucket: "cleanup", receivedAt: "8:02 AM", unread: true, promo: true },
  { id: "c2", sender: "Headspace", subject: "Your weekly mindful minute", snippet: "Take a breath. Here's this week's 1-minute reset.", bucket: "cleanup", receivedAt: "7:30 AM", unread: true, promo: true },
  { id: "c3", sender: "LinkedIn", subject: "Sarah viewed your profile + 12 more", snippet: "See who's been checking out your work this week.", bucket: "cleanup", receivedAt: "Tue", unread: true, promo: true },
  { id: "c4", sender: "Allbirds", subject: "Last call: 30% off — ends midnight", snippet: "We hate to be that brand but the sale really does end…", bucket: "cleanup", receivedAt: "Tue", unread: true, promo: true },
  { id: "c5", sender: "Notion Updates", subject: "What's new in Notion: AI blocks, sync databases", snippet: "Here's everything that shipped this month.", bucket: "cleanup", receivedAt: "Mon", unread: true, promo: true },
  { id: "c6", sender: "Slack notifications", subject: "Daily digest from #design-crit", snippet: "12 new messages while you were away.", bucket: "cleanup", receivedAt: "Mon", unread: true, promo: true },
  { id: "c7", sender: "Morning Brew", subject: "☕ Markets, AI, and one weird trick", snippet: "Today: a chip war, a chip-maker pivot, and chips.", bucket: "cleanup", receivedAt: "Mon", unread: true, promo: true },
  { id: "c8", sender: "Spotify", subject: "Your Wrapped is almost here 🎁", snippet: "You listened to a lot of Phoebe Bridgers. We have receipts.", bucket: "cleanup", receivedAt: "Sun", unread: true, promo: true },
  { id: "c9", sender: "Doordash", subject: "$5 off your next order — today only", snippet: "Hungry? We have a deal that might help.", bucket: "cleanup", receivedAt: "Sun", unread: true, promo: true },

  // --- Past / handled — quietly demoted.
  { id: "p1", sender: "Stripe", subject: "Receipt: Invoice #INV-0428 — $1,420.00 paid", snippet: "Thanks — your invoice was paid on May 18.", bucket: "past", receivedAt: "May 18" },
  { id: "p2", sender: "Calendar", subject: "Past event: Coffee w/ Anh — May 22, 10am", snippet: "Recap: confirmed attended.", bucket: "past", receivedAt: "May 22" },
];

export const TOTAL_UNREAD = 137;

export type Decision = {
  id: string;
  title: string;
  why: string;
  badges: Array<{ label: string; tone: "warn" | "accent" | "success" | "danger" | "neutral" }>;
  meta?: string;
  source: { count: number; label: string };
};

export const DEMO_DECISIONS: Decision[] = [
  {
    id: "d1",
    title: "Reply to Dana about the Thursday call",
    why: "She's nudged twice — you haven't picked a time yet. 2pm or 1:30 work.",
    badges: [
      { label: "Today", tone: "warn" },
      { label: "Folded 2 emails", tone: "neutral" },
    ],
    source: { count: 2, label: "from Dana Park" },
  },
  {
    id: "d2",
    title: "Pay the $240 ConEd bill — now 2 weeks overdue",
    why: "Final notice landed two weeks ago. Bills don't get less urgent with age.",
    badges: [
      { label: "Overdue", tone: "danger" },
      { label: "Money", tone: "neutral" },
    ],
    meta: "Due 2 weeks ago",
    source: { count: 1, label: "from ConEd" },
  },
  {
    id: "d3",
    title: "Confirm the apartment viewing Sat 2pm",
    why: "Marisol asked to lock it in. Buzzer #4A, 219 Greene St.",
    badges: [
      { label: "This week", tone: "accent" },
      { label: "Event", tone: "neutral" },
    ],
    meta: "Saturday",
    source: { count: 1, label: "from Marisol" },
  },
];

export const CLEANUP_SUMMARY = {
  count: 61,
  label: "newsletters & promos",
  cta: "tidy up?",
};

export const PAST_SUMMARY = {
  count: 8,
  label: "likely already handled",
  hint: "Receipts, a paid invoice, a passed meeting…",
};

export const DAY_SUMMARY =
  "3 things need you today: nudge Dana, pay ConEd, confirm Saturday.";
