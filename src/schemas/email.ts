import { z } from 'zod';

export const EmailAddressSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().or(z.string().min(1)), // Gmail DOM sometimes hides the full address
});
export type EmailAddress = z.infer<typeof EmailAddressSchema>;

export const ProviderSchema = z.enum(['gmail', 'outlook']);
export type Provider = z.infer<typeof ProviderSchema>;

/**
 * A single message as extracted from the visible Gmail DOM. This is INPUT to
 * the agent layer — no classification has happened yet.
 *
 * Field policy:
 *  - `id` is the Gmail data-legacy-message-id when available, else a stable hash
 *    of (threadId, from, subject, snippet).
 *  - `snippet` is what Gmail shows in the row preview (~120 chars).
 *  - `bodyExcerpt` is at most 512 chars unless EMAIL_SIGNAL_SEND_FULL_BODIES=true,
 *    so we don't ship full email content into LLM prompts by default.
 */
export const EmailCandidateSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  provider: ProviderSchema,
  from: EmailAddressSchema,
  to: z.array(EmailAddressSchema).default([]),
  subject: z.string().default(''),
  snippet: z.string().default(''),
  bodyExcerpt: z.string().max(8192).default(''),
  receivedAt: z.string().datetime().optional(),
  isUnread: z.boolean().default(false),
  isStarred: z.boolean().default(false),
  labels: z.array(z.string()).default([]),
  hasUnsubscribeLink: z.boolean().default(false),
  unsubscribeLinkHrefs: z.array(z.string()).default([]),
  listUnsubscribeHeader: z.string().optional(), // when extractable
  attachmentsCount: z.number().int().min(0).default(0),
  // DOM selectors we can use later to scroll-to / highlight without re-extracting.
  domAnchor: z
    .object({
      rowSelector: z.string().optional(),
      threadSelector: z.string().optional(),
    })
    .default({}),
});
export type EmailCandidate = z.infer<typeof EmailCandidateSchema>;

export const EmailThreadSummarySchema = z.object({
  threadId: z.string().min(1),
  provider: ProviderSchema,
  messageCount: z.number().int().min(1),
  participants: z.array(EmailAddressSchema),
  subject: z.string().default(''),
  latestSnippet: z.string().default(''),
  latestReceivedAt: z.string().datetime().optional(),
  hasUnread: z.boolean().default(false),
  candidates: z.array(EmailCandidateSchema).default([]),
});
export type EmailThreadSummary = z.infer<typeof EmailThreadSummarySchema>;

export const ScanResultSchema = z.object({
  provider: ProviderSchema,
  scannedAt: z.string().datetime(),
  source: z.enum(['inbox', 'search', 'thread', 'mock']),
  pageUrl: z.string().url().optional(),
  candidates: z.array(EmailCandidateSchema),
  threads: z.array(EmailThreadSummarySchema).default([]),
  warnings: z.array(z.string()).default([]),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;
