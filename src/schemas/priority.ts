import { z } from 'zod';

export const PriorityCategorySchema = z.enum([
  'payment_reminder',
  'bill',
  'scheduling',
  'recruiter',
  'job',
  'reply_requested',
  'family_personal',
  'overdue_response',
  'deadline',
  'travel_logistics',
  'other_important',
]);
export type PriorityCategory = z.infer<typeof PriorityCategorySchema>;

export const UrgencyLevelSchema = z.enum(['critical', 'high', 'normal', 'low']);
export type UrgencyLevel = z.infer<typeof UrgencyLevelSchema>;

/**
 * Structured signals attached by the heuristic pass so the downstream synthesis
 * agent has parsed data to work with (amount, ISO due date, RSVP ask) without
 * re-reading the body.
 */
export const PrioritySignalsSchema = z.object({
  amount: z.string().nullable().optional(),
  amountCurrency: z.string().nullable().optional(),
  dueAtIso: z.string().nullable().optional(),
  rsvpAsk: z.boolean().nullable().optional(),
  payee: z.string().nullable().optional(),
});
export type PrioritySignals = z.infer<typeof PrioritySignalsSchema>;

export const PriorityFindingSchema = z.object({
  emailId: z.string(),
  threadId: z.string(),
  senderDisplay: z.string(),
  subject: z.string(),
  category: PriorityCategorySchema,
  urgency: UrgencyLevelSchema,
  dueAt: z.string().nullable().optional(),
  ask: z.string().max(500).nullable().optional(),
  needsReply: z.boolean(),
  rationale: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  excerpt: z.string().max(1200),
  signals: PrioritySignalsSchema.nullable().optional(),
});
export type PriorityFinding = z.infer<typeof PriorityFindingSchema>;

export const ActionItemThemeSchema = z.enum([
  'money',
  'awaiting_reply',
  'calendar',
  'career',
  'travel',
  'family',
]);
export type ActionItemTheme = z.infer<typeof ActionItemThemeSchema>;

export const ActionItemUrgencySchema = z.enum(['critical', 'high', 'normal']);
export type ActionItemUrgency = z.infer<typeof ActionItemUrgencySchema>;

export const ActionItemSuggestedActionSchema = z.enum([
  'snooze',
  'mark_done',
  'open_thread',
  'propose_reply',
]);
export type ActionItemSuggestedAction = z.infer<typeof ActionItemSuggestedActionSchema>;

export const ActionItemSourceSchema = z.object({
  emailId: z.string(),
  threadId: z.string(),
  senderDisplay: z.string(),
  subject: z.string(),
});
export type ActionItemSource = z.infer<typeof ActionItemSourceSchema>;

export const ActionItemSchema = z.object({
  id: z.string(),
  action: z.string().min(1).max(100),
  why: z.string().min(1).max(200),
  urgency: ActionItemUrgencySchema,
  dueAt: z.string().nullable().optional(),
  sources: z.array(ActionItemSourceSchema).min(1),
  suggestedActions: z.array(ActionItemSuggestedActionSchema).default([]),
  confidence: z.number().min(0).max(1),
  theme: ActionItemThemeSchema.nullable().optional(),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;
