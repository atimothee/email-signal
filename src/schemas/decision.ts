import { z } from 'zod';

/**
 * A Decision is the product's core unit: ONE thing the user must decide or do
 * today, synthesized from one OR MORE emails. This is the opposite of the old
 * "one email -> one card" selection model. Two recruiters waiting on you is a
 * single Decision, not two cards.
 *
 * Decisions are what the Today tab renders. Clutter (newsletters, marketing,
 * notifications) never becomes a Decision — it flows to the Cleanup tab.
 */

export const DecisionThemeSchema = z.enum([
  'money', // bills, payments, invoices that need action
  'reply', // someone is waiting on a response from you
  'schedule', // meetings, RSVPs, calendar coordination
  'job', // recruiters, interviews, career
  'travel', // flights, check-ins, reservations
  'admin', // accounts, documents, statements (FYI, usually no $ action)
  'security', // password resets, suspicious activity, verification
  'other',
]);
export type DecisionTheme = z.infer<typeof DecisionThemeSchema>;

export const DecisionUrgencySchema = z.enum(['critical', 'high', 'normal', 'low']);
export type DecisionUrgency = z.infer<typeof DecisionUrgencySchema>;

export const DecisionActionKindSchema = z.enum([
  'reply',
  'pay',
  'open',
  'schedule',
  'review',
  'none',
]);
export type DecisionActionKind = z.infer<typeof DecisionActionKindSchema>;

export const DecisionActionSchema = z.object({
  /** Verb-led button label in the user's voice, e.g. "Reply to Maya". */
  label: z.string().min(1).max(48),
  kind: DecisionActionKindSchema,
});
export type DecisionAction = z.infer<typeof DecisionActionSchema>;

export const DecisionSchema = z.object({
  id: z.string(),
  /** Verb-led, user's voice. "Pay Absa R1,240 by Friday", not "Absa statement". */
  title: z.string().min(1).max(140),
  /** One sentence — why this matters, in the user's voice. */
  why: z.string().min(1).max(400),
  theme: DecisionThemeSchema,
  urgency: DecisionUrgencySchema,
  /** Every email folded into this decision. */
  emailIds: z.array(z.string()).default([]),
  /** Resolved, human-friendly sender names (never "noreply"). */
  senders: z.array(z.string()).default([]),
  count: z.number().int().min(1).default(1),
  /** Due date if extractable; forgiving string (LLMs rarely emit strict ISO). */
  dueAt: z.string().nullable().optional(),
  suggestedAction: DecisionActionSchema.nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.7),
  /** DOM selector for "Show in Gmail" on the first email, when known. */
  rowSelector: z.string().nullable().optional(),

  // ── Temporal intelligence ──────────────────────────────────────────────
  // The action's time character, so recency can be reasoned about correctly:
  // a `deadline` stays open until done (an old unpaid bill is MORE urgent with
  // age), whereas an `event` simply passes (a viewing/flight that already
  // happened is dead). Model-provided.
  windowType: z.enum(['deadline', 'event', 'standing', 'none']).default('none'),
  /**
   * True ONLY on explicit in-thread evidence the action is already done
   * (a later "paid"/"confirmed"/"thanks, done" or the user's own reply).
   * Absence of evidence is NOT resolution. Model-provided.
   */
  resolved: z.boolean().default(false),
  /**
   * Received date (ISO) of the most recent email folded into this decision —
   * for recency display and ranking. Null when the scan couldn't read a date
   * (treated as recent, never as old). Server-filled.
   */
  receivedAt: z.string().nullable().optional(),
  /**
   * Server-computed: this decision was DEMOTED to the quiet "likely past —
   * handled?" group (stale, a passed event, or resolved). It is never hidden,
   * only sunk one tap away — hiding a live item is worse than surfacing a dead
   * one, so demotion only ever reorders.
   */
  demoted: z.boolean().default(false),
  /**
   * Short, hedged reason shown on a demoted card, e.g.
   * "from 3 weeks ago — likely already handled". Null when not demoted.
   */
  demotedReason: z.string().nullable().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;
