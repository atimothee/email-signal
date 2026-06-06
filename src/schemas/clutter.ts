import { z } from 'zod';

export const ClutterCategorySchema = z.enum([
  'promotion',
  'newsletter',
  'marketing',
  'cold_outreach',
  'automated_notification',
  'repeat_sender_low_signal',
  'social_update',
  'receipt_or_confirmation',
  'other',
]);
export type ClutterCategory = z.infer<typeof ClutterCategorySchema>;

export const ClutterSuggestedActionSchema = z.enum([
  'unsubscribe',
  'mark_read',
  'archive',
  'label',
  'open_only',
  'ignore',
]);
export type ClutterSuggestedAction = z.infer<typeof ClutterSuggestedActionSchema>;

export const ClutterFindingSchema = z.object({
  emailId: z.string(),
  threadId: z.string(),
  senderDomain: z.string(),
  senderDisplay: z.string(),
  category: ClutterCategorySchema,
  confidence: z.number().min(0).max(1),
  /** Generous cap — LLMs routinely write rationales longer than 600 chars. */
  rationale: z.string().min(1).max(2000),
  suggestedAction: ClutterSuggestedActionSchema,
  hasUnsubscribeLink: z.boolean(),
  reversible: z.boolean(),
});
export type ClutterFinding = z.infer<typeof ClutterFindingSchema>;

/** Aggregated view by sender for the Clutter tab UI. */
export const ClutterSenderGroupSchema = z.object({
  senderDomain: z.string(),
  senderDisplay: z.string(),
  count: z.number().int().min(1),
  exampleSubjects: z.array(z.string()).max(5),
  category: ClutterCategorySchema,
  averageConfidence: z.number().min(0).max(1),
  rationale: z.string(),
  suggestedActions: z.array(ClutterSuggestedActionSchema),
  emailIds: z.array(z.string()),
});
export type ClutterSenderGroup = z.infer<typeof ClutterSenderGroupSchema>;
