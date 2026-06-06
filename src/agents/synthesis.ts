import { nanoid } from 'nanoid';
import {
  ActionItem,
  ActionItemSchema,
  ActionItemSuggestedAction,
  ActionItemTheme,
  ActionItemUrgency,
  ClutterFinding,
  EmailCandidate,
  PriorityFinding,
} from '@schemas/index';

const CONFIDENCE_FLOOR = 0.55;
const MIN_VISIBLE_ITEMS = 2;
const MAX_SOURCES_PER_ITEM = 3;

const CLUTTER_CATEGORIES = new Set([
  'promotion',
  'newsletter',
  'marketing',
  'automated_notification',
  'social_update',
  'repeat_sender_low_signal',
]);

function themeFor(category: PriorityFinding['category']): ActionItemTheme | undefined {
  switch (category) {
    case 'payment_reminder':
    case 'bill':
      return 'money';
    case 'scheduling':
      return 'calendar';
    case 'recruiter':
    case 'job':
      return 'career';
    case 'reply_requested':
    case 'overdue_response':
      return 'awaiting_reply';
    case 'travel_logistics':
      return 'travel';
    case 'family_personal':
      return 'family';
    default:
      return undefined;
  }
}

function mapUrgency(u: PriorityFinding['urgency']): ActionItemUrgency {
  return u === 'low' ? 'normal' : (u as ActionItemUrgency);
}

function suggestedFor(category: PriorityFinding['category']): ActionItemSuggestedAction[] {
  switch (category) {
    case 'payment_reminder':
    case 'bill':
      return ['mark_done', 'open_thread', 'snooze'];
    case 'recruiter':
    case 'job':
    case 'reply_requested':
    case 'overdue_response':
      return ['propose_reply', 'open_thread', 'snooze'];
    case 'scheduling':
      return ['propose_reply', 'open_thread', 'snooze'];
    default:
      return ['open_thread', 'mark_done', 'snooze'];
  }
}

function fmtAmount(p: PriorityFinding): string | null {
  const a = p.signals?.amount;
  if (!a) return null;
  const cur = p.signals?.amountCurrency;
  const sym = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '$';
  return `${sym}${a}`;
}

function fmtDue(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return 'today';
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function buildAction(p: PriorityFinding): string {
  const senderShort = p.senderDisplay.split('@')[0]!.split(/[<\s]/)[0] || p.senderDisplay;
  const amount = fmtAmount(p);
  const due = fmtDue(p.signals?.dueAtIso ?? p.dueAt ?? null);
  switch (p.category) {
    case 'payment_reminder':
    case 'bill': {
      const payee = p.signals?.payee ?? senderShort;
      if (amount && due) return clip(`Pay ${payee} ${amount} by ${due}`, 100);
      if (amount) return clip(`Pay ${payee} ${amount}`, 100);
      if (due) return clip(`Pay ${payee} by ${due}`, 100);
      return clip(`Pay ${payee}`, 100);
    }
    case 'scheduling':
      if (due) return clip(`RSVP to ${senderShort} for ${due}`, 100);
      return clip(`RSVP to ${senderShort}`, 100);
    case 'recruiter':
    case 'job':
      return clip(`Reply to ${senderShort} about ${p.subject || 'the role'}`, 100);
    case 'reply_requested':
    case 'overdue_response':
      return clip(`Reply to ${senderShort}${p.subject ? ` re ${p.subject}` : ''}`, 100);
    case 'travel_logistics':
      if (due) return clip(`Check in / prep travel by ${due}`, 100);
      return clip(`Check travel: ${p.subject || senderShort}`, 100);
    case 'family_personal':
      return clip(`Respond to ${senderShort}`, 100);
    case 'deadline':
      if (due) return clip(`Hit deadline ${due}: ${p.subject}`, 100);
      return clip(`Hit deadline: ${p.subject}`, 100);
    default:
      return clip(`Handle ${p.subject || senderShort}`, 100);
  }
}

function buildWhy(p: PriorityFinding): string {
  if (p.ask) return clip(p.ask, 200);
  const due = fmtDue(p.signals?.dueAtIso ?? p.dueAt ?? null);
  if (p.category === 'payment_reminder' || p.category === 'bill') {
    const amt = fmtAmount(p);
    if (amt && due) return clip(`${amt} is due ${due} — avoid late fees.`, 200);
    if (due) return clip(`Payment is due ${due} — avoid late fees.`, 200);
  }
  if (due) return clip(`Due ${due}.`, 200);
  return clip(p.subject || 'Needs your attention.', 200);
}

function clusterKey(p: PriorityFinding): string {
  return `${p.category}:${p.senderDisplay.toLowerCase().trim()}`;
}

/**
 * Deterministic synthesis used when the sidecar is unreachable or as the
 * upstream input that the LLM call refines. Mirrors the contract the eval
 * suite asserts against.
 */
export function synthesizeActionItemsLocal(input: {
  priorities: PriorityFinding[];
  clutter: ClutterFinding[];
  candidates?: EmailCandidate[];
}): ActionItem[] {
  const clutterIds = new Set<string>();
  for (const c of input.clutter) {
    if (CLUTTER_CATEGORIES.has(c.category)) clutterIds.add(c.emailId);
  }

  const eligible = input.priorities
    .filter((p) => !clutterIds.has(p.emailId))
    .filter((p) => p.confidence >= CONFIDENCE_FLOOR);

  const clusters = new Map<string, PriorityFinding[]>();
  for (const p of eligible) {
    const k = clusterKey(p);
    const arr = clusters.get(k) ?? [];
    arr.push(p);
    clusters.set(k, arr);
  }

  // Also collapse multi-recruiter clusters by category alone (issue example).
  const recruiterBucket: PriorityFinding[] = [];
  for (const [k, arr] of clusters) {
    if (k.startsWith('recruiter:') && arr.length === 1) {
      recruiterBucket.push(arr[0]!);
      clusters.delete(k);
    }
  }
  if (recruiterBucket.length >= 2) {
    clusters.set('recruiter:*', recruiterBucket);
  } else {
    for (const r of recruiterBucket) clusters.set(clusterKey(r), [r]);
  }

  const items: ActionItem[] = [];
  for (const [, group] of clusters) {
    const lead = [...group].sort((a, b) => b.confidence - a.confidence)[0]!;
    const sourcesAll = group.slice(0, MAX_SOURCES_PER_ITEM).map((p) => ({
      emailId: p.emailId,
      threadId: p.threadId,
      senderDisplay: p.senderDisplay,
      subject: p.subject,
    }));

    let action: string;
    let why: string;
    if (group.length >= 2 && (lead.category === 'recruiter' || lead.category === 'job')) {
      const names = group
        .map((p) => p.senderDisplay.split(/[<\s]/)[0])
        .filter(Boolean)
        .slice(0, 2)
        .join(' & ');
      action = clip(`Reply to ${group.length} recruiters waiting — ${names}`, 100);
      why = clip(`Multiple recruiter threads pending a response.`, 200);
    } else if (group.length >= 2) {
      action = buildAction(lead);
      why = clip(`${group.length} related threads — ${buildWhy(lead)}`, 200);
    } else {
      action = buildAction(lead);
      why = buildWhy(lead);
    }

    const urgency = mapUrgency(lead.urgency);
    const item: ActionItem = ActionItemSchema.parse({
      id: nanoid(),
      action,
      why,
      urgency,
      dueAt: lead.signals?.dueAtIso ?? lead.dueAt ?? undefined,
      sources: sourcesAll,
      suggestedActions: suggestedFor(lead.category),
      confidence: Math.min(
        0.99,
        group.reduce((s, p) => s + p.confidence, 0) / group.length + (group.length >= 2 ? 0.05 : 0)
      ),
      theme: themeFor(lead.category) ?? undefined,
    });
    items.push(item);
  }

  return sortActionItems(items);
}

export function sortActionItems(items: ActionItem[]): ActionItem[] {
  const todayIso = new Date().toISOString().slice(0, 10);
  return [...items].sort((a, b) => {
    const aToday = (a.dueAt ?? '').slice(0, 10) === todayIso ? 1 : 0;
    const bToday = (b.dueAt ?? '').slice(0, 10) === todayIso ? 1 : 0;
    if (aToday !== bToday) return bToday - aToday;
    const score = (i: ActionItem): number => {
      const u = i.urgency === 'critical' ? 1.0 : i.urgency === 'high' ? 0.7 : 0.4;
      return u * i.confidence;
    };
    return score(b) - score(a);
  });
}

/** Filter items below the "show this list" threshold per the issue spec. */
export function applyVisibilityFloor(items: ActionItem[]): ActionItem[] {
  const high = items.filter((i) => i.confidence >= 0.7);
  if (high.length < MIN_VISIBLE_ITEMS) return [];
  return items.filter((i) => i.confidence >= CONFIDENCE_FLOOR);
}

export const __SYNTHESIS = {
  CONFIDENCE_FLOOR,
  MIN_VISIBLE_ITEMS,
  MAX_SOURCES_PER_ITEM,
};
