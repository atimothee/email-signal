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

export const PriorityFindingSchema = z.object({
  emailId: z.string(),
  threadId: z.string(),
  senderDisplay: z.string(),
  subject: z.string(),
  category: PriorityCategorySchema,
  urgency: UrgencyLevelSchema,
  /**
   * Due date if extractable from the body. Accepts any string format
   * (`"2026-06-15"`, `"2026-06-15T00:00:00Z"`, `"next Friday"`) — LLMs are
   * unreliable about emitting strict ISO datetime, and we display via
   * `new Date(dueAt)` which is forgiving. Use `.nullable().optional()` so
   * the OpenAI structured-outputs API accepts "absent" as `null`.
   */
  dueAt: z.string().nullable().optional(),
  /** The explicit ask, if any ("can you confirm?", "RSVP", "approve invoice"). */
  ask: z.string().max(500).nullable().optional(),
  needsReply: z.boolean(),
  /** Rationale length cap is generous — LLMs blow past 600 chars regularly. */
  rationale: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  /** Snippet to surface in card UI. Capped generously for the same reason. */
  excerpt: z.string().max(1200),
});
export type PriorityFinding = z.infer<typeof PriorityFindingSchema>;
