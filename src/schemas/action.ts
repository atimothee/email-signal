import { z } from 'zod';

export const ActionTypeSchema = z.enum([
  'open_email',
  'highlight_element',
  'scroll_to_element',
  'find_unsubscribe_link',
  'click_unsubscribe',
  'mark_read',
  'archive',
  'apply_label',
  'suggest_label',
  'remember_preference',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const RiskLevelSchema = z.enum(['none', 'low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ApprovalStatusSchema = z.enum([
  'not_required',
  'pending',
  'approved',
  'rejected',
  'expired',
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

/**
 * Proposed but NOT-YET-EXECUTED action. Created by an agent, vetted by the
 * ActionPolicyAgent, surfaced in UI as an ApprovalActionCard, and only then
 * (optionally) handed to the ActionExecutor.
 */
export const ProposedActionSchema = z.object({
  id: z.string(),
  emailId: z.string().optional(),
  threadId: z.string().optional(),
  type: ActionTypeSchema,
  /** Human-facing title for the approval card, e.g. "Unsubscribe from Acme Marketing". */
  title: z.string().min(1).max(140),
  /** Plain-language rationale shown to the user. */
  rationale: z.string().min(1).max(600),
  proposedBy: z.string(), // agent name
  /** Capability/permission name this action needs; used by ActionPolicyAgent. */
  requiredPermission: z.enum([
    'dom_read',
    'dom_highlight',
    'dom_click_unsubscribe',
    'dom_click_archive',
    'dom_click_mark_read',
    'memory_write',
    'label_suggest',
  ]),
  reversible: z.boolean(),
  risk: RiskLevelSchema,
  approvalStatus: ApprovalStatusSchema,
  /** Optional inline parameters (e.g. unsubscribe href, label name). */
  params: z.record(z.unknown()).default({}),
  proposedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
});
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

export const ApprovalRecordSchema = z.object({
  proposedActionId: z.string(),
  status: ApprovalStatusSchema,
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().default('user'),
  /** Optional user-supplied note ("only this one, not the whole sender"). */
  note: z.string().max(400).optional(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const ExecutedActionResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  /** Before/after captured from the DOM where detectable. */
  before: z.record(z.unknown()).optional(),
  after: z.record(z.unknown()).optional(),
});
export type ExecutedActionResult = z.infer<typeof ExecutedActionResultSchema>;

export const ExecutedActionSchema = z.object({
  id: z.string(),
  proposedActionId: z.string(),
  type: ActionTypeSchema,
  executedAt: z.string().datetime(),
  executedBy: z.string(), // tool / agent
  dryRun: z.boolean(),
  result: ExecutedActionResultSchema,
});
export type ExecutedAction = z.infer<typeof ExecutedActionSchema>;

/** The permanent record stored in the ledger. */
export const ActionLedgerEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  emailId: z.string().optional(),
  threadId: z.string().optional(),
  sender: z.string().optional(),
  proposed: ProposedActionSchema,
  approval: ApprovalRecordSchema.optional(),
  executed: ExecutedActionSchema.optional(),
});
export type ActionLedgerEntry = z.infer<typeof ActionLedgerEntrySchema>;
