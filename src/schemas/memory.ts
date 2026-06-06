import { z } from 'zod';

export const PreferenceKindSchema = z.enum([
  'important_sender',
  'ignored_sender',
  'important_topic',
  'liked_newsletter',
  'brief_style',
  'time_sensitive_category',
  'notification_frequency',
  'custom',
]);
export type PreferenceKind = z.infer<typeof PreferenceKindSchema>;

export const UserPreferenceSchema = z.object({
  id: z.string(),
  kind: PreferenceKindSchema,
  /** Stable lookup key (e.g. "acme.com" for an ignored sender). */
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  source: z.enum(['user_settings', 'agent_suggested_then_approved']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserPreference = z.infer<typeof UserPreferenceSchema>;

/**
 * A learned pattern (recallable across sessions). Agent-suggested
 * MemoryRecord entries MUST be surfaced as a MemorySuggestionCard before
 * being written.
 */
export const MemoryRecordSchema = z.object({
  id: z.string(),
  kind: z.enum(['preference', 'interaction_pattern', 'fact', 'topic_interest']),
  summary: z.string().min(1).max(400),
  details: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
  /** Optional vector embedding placeholder for later semantic recall. */
  embedding: z.array(z.number()).optional(),
  /** Tracks who/what asserted this memory. */
  source: z.enum(['user', 'agent_suggested', 'system']),
  approvedByUser: z.boolean().default(false),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const MemorySuggestionSchema = z.object({
  id: z.string(),
  suggestion: z.string().min(1).max(400),
  proposedRecord: MemoryRecordSchema,
  rationale: z.string().max(600),
  proposedAt: z.string().datetime(),
});
export type MemorySuggestion = z.infer<typeof MemorySuggestionSchema>;
