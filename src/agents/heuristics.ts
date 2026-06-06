import {
  ClutterCategory,
  ClutterFinding,
  ClutterSuggestedAction,
  EmailCandidate,
  PriorityCategory,
  PriorityFinding,
  PrioritySignals,
  UrgencyLevel,
} from '@schemas/index';
import { getSenderDomain } from '@/providers/gmail';

/**
 * Deterministic, fast, no-LLM fallback classifiers. They run first and
 * either:
 *  - settle a high-confidence case immediately (cheap & private), or
 *  - hand off to the LLM-backed agent for ambiguous cases.
 *
 * These are intentionally simple — the LLM agent does the nuanced work.
 */

const PROMO_KEYWORDS = [
  '% off',
  'sale',
  'limited time',
  'shop now',
  'deal',
  'free shipping',
  'subscribe',
  'newsletter',
  'unsubscribe',
];

const PAYMENT_KEYWORDS = ['invoice', 'bill is due', 'payment due', 'amount due', 'statement', 'past due'];
const SCHEDULING_KEYWORDS = ['rsvp', 'meet', 'lunch', 'are you free', 'schedule', 'calendar invite'];
const JOB_KEYWORDS = ['role', 'opening', 'opportunity', 'recruiter', 'engineering manager', 'position'];
const TRAVEL_KEYWORDS = ['flight', 'check in', 'itinerary', 'reservation', 'gate '];
const REPLY_HINTS = ['can you', 'could you', 'please', '?', 'let me know'];
const FAMILY_DOMAINS = ['family.example']; // demo placeholder

function score(haystack: string, needles: string[]): number {
  const lower = haystack.toLowerCase();
  let hits = 0;
  for (const n of needles) if (lower.includes(n)) hits++;
  return hits / Math.max(needles.length, 1);
}

export function quickClutterPass(c: EmailCandidate): ClutterFinding | null {
  const hay = `${c.subject} ${c.snippet} ${c.bodyExcerpt}`;
  const promo = score(hay, PROMO_KEYWORDS);
  if (c.hasUnsubscribeLink && promo > 0.15) {
    const category: ClutterCategory = promo > 0.3 ? 'promotion' : 'newsletter';
    return {
      emailId: c.id,
      threadId: c.threadId,
      senderDomain: getSenderDomain(c),
      senderDisplay: c.from.name ?? c.from.email,
      category,
      confidence: Math.min(0.95, 0.55 + promo),
      rationale:
        category === 'promotion'
          ? 'Subject/snippet matches promotional language and the email exposes an unsubscribe link.'
          : 'Recurring newsletter pattern with an unsubscribe link in the body.',
      suggestedAction: 'unsubscribe' as ClutterSuggestedAction,
      hasUnsubscribeLink: true,
      reversible: false,
    };
  }
  if (c.hasUnsubscribeLink) {
    return {
      emailId: c.id,
      threadId: c.threadId,
      senderDomain: getSenderDomain(c),
      senderDisplay: c.from.name ?? c.from.email,
      category: 'newsletter',
      confidence: 0.55,
      rationale: 'Has an unsubscribe link but no obvious promo signals.',
      suggestedAction: 'mark_read',
      hasUnsubscribeLink: true,
      reversible: true,
    };
  }
  return null;
}

const AMOUNT_RE = /(?:USD|US\$|\$|€|£)\s?(\d{1,3}(?:[,]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;
const ISO_DATE_RE = /\b(20\d{2}-[01]\d-[0-3]\d)\b/;
const MONTH_DAY_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z.]*\s+([0-3]?\d)(?:[,]?\s*(20\d{2}))?\b/i;
const RSVP_RE = /\b(rsvp|are you (?:able|free|coming)|can you (?:make|attend|join)|will you be able)\b/i;
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

function extractSignals(c: EmailCandidate, top: { category: PriorityCategory }): PrioritySignals {
  const hay = `${c.subject}\n${c.snippet}\n${c.bodyExcerpt}`;
  const signals: PrioritySignals = {};

  const amt = hay.match(AMOUNT_RE);
  if (amt) {
    signals.amount = amt[1] ?? null;
    const sym = amt[0].trim()[0];
    signals.amountCurrency = sym === '€' ? 'EUR' : sym === '£' ? 'GBP' : 'USD';
  }

  const iso = hay.match(ISO_DATE_RE);
  if (iso) {
    signals.dueAtIso = iso[1] ?? null;
  } else {
    const md = hay.match(MONTH_DAY_RE);
    if (md) {
      const monthIdx = MONTHS[md[1]!.toLowerCase()];
      const day = Number(md[2]);
      const year = md[3] ? Number(md[3]) : new Date().getUTCFullYear();
      if (monthIdx !== undefined && Number.isFinite(day)) {
        const iso2 = new Date(Date.UTC(year, monthIdx, day)).toISOString().slice(0, 10);
        signals.dueAtIso = iso2;
      }
    }
  }

  if (top.category === 'scheduling' || top.category === 'family_personal') {
    signals.rsvpAsk = RSVP_RE.test(hay);
  }

  if (top.category === 'payment_reminder' || top.category === 'bill') {
    signals.payee = c.from.name ?? c.from.email;
  }

  return signals;
}

export function quickPriorityPass(c: EmailCandidate): PriorityFinding | null {
  const hay = `${c.subject} ${c.snippet} ${c.bodyExcerpt}`;
  const payment = score(hay, PAYMENT_KEYWORDS);
  const sched = score(hay, SCHEDULING_KEYWORDS);
  const job = score(hay, JOB_KEYWORDS);
  const travel = score(hay, TRAVEL_KEYWORDS);
  const reply = score(hay, REPLY_HINTS);
  const fromFamily = FAMILY_DOMAINS.some((d) => c.from.email.endsWith(d));

  type Pick = { category: PriorityCategory; urgency: UrgencyLevel; w: number; ask?: string };
  const picks: Pick[] = [];
  if (payment > 0) picks.push({ category: 'payment_reminder', urgency: 'high', w: payment + 0.5 });
  if (sched > 0) picks.push({ category: 'scheduling', urgency: 'normal', w: sched + 0.3, ask: 'Confirm availability' });
  if (job > 0) picks.push({ category: 'recruiter', urgency: 'normal', w: job + 0.3 });
  if (travel > 0) picks.push({ category: 'travel_logistics', urgency: 'high', w: travel + 0.4 });
  if (reply > 0 && !c.hasUnsubscribeLink) picks.push({ category: 'reply_requested', urgency: 'normal', w: reply + 0.15, ask: 'Respond' });
  if (fromFamily) picks.push({ category: 'family_personal', urgency: 'high', w: 0.9 });

  if (picks.length === 0) return null;
  picks.sort((a, b) => b.w - a.w);
  const top = picks[0]!;
  const signals = extractSignals(c, top);
  return {
    emailId: c.id,
    threadId: c.threadId,
    senderDisplay: c.from.name ?? c.from.email,
    subject: c.subject,
    category: top.category,
    urgency: top.urgency,
    needsReply: top.category === 'reply_requested' || top.category === 'family_personal',
    rationale: `Heuristic match on ${top.category}.`,
    confidence: Math.min(0.9, 0.5 + top.w * 0.4),
    excerpt: c.snippet.slice(0, 400),
    ask: top.ask,
    dueAt: signals.dueAtIso ?? undefined,
    signals,
  };
}
