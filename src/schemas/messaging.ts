import { z } from 'zod';
import { ScanResultSchema, EmailCandidateSchema } from './email.js';
import { ProposedActionSchema, ApprovalRecordSchema, ActionLedgerEntrySchema } from './action.js';
import { ClutterFindingSchema, ClutterSenderGroupSchema } from './clutter.js';
import { PriorityFindingSchema, ActionItemSchema } from './priority.js';
import { DailyBriefSchema } from './brief.js';
import { AgentTraceEventSchema } from './trace.js';
import { MemorySuggestionSchema, UserPreferenceSchema } from './memory.js';

/**
 * Wire protocol between content script <-> service worker <-> side panel.
 * Every message MUST be parsed by this schema on receive. Drop unknown
 * messages rather than throwing — Gmail injects unrelated postMessage events.
 */
export const ExtMessageSchema = z.discriminatedUnion('kind', [
  // content -> background
  z.object({ kind: z.literal('content/ready'), tabId: z.number().optional() }),
  z.object({ kind: z.literal('content/scan_result'), scan: ScanResultSchema }),
  z.object({
    kind: z.literal('content/dom_action_result'),
    proposedActionId: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
    before: z.record(z.unknown()).optional(),
    after: z.record(z.unknown()).optional(),
  }),
  // background -> content
  z.object({ kind: z.literal('bg/request_scan'), source: z.enum(['inbox', 'thread', 'search']) }),
  z.object({ kind: z.literal('bg/execute_dom_action'), action: ProposedActionSchema }),
  z.object({ kind: z.literal('bg/highlight'), selector: z.string() }),

  // sidepanel <-> background
  z.object({ kind: z.literal('panel/hello') }),
  z.object({ kind: z.literal('panel/request_scan') }),
  z.object({ kind: z.literal('panel/request_brief') }),
  z.object({ kind: z.literal('panel/chat_message'), text: z.string().min(1).max(4000) }),
  z.object({ kind: z.literal('panel/approve_action'), approval: ApprovalRecordSchema }),
  z.object({ kind: z.literal('panel/reject_action'), proposedActionId: z.string() }),
  z.object({
    kind: z.literal('panel/batch_approve'),
    proposedActionIds: z.array(z.string()).min(1).max(200),
    confirmedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('panel/always_suggest'),
    proposedActionId: z.string(),
    /** Stable key for the suggestion pattern (e.g. sender domain or action type). */
    patternKey: z.string(),
  }),
  z.object({
    kind: z.literal('panel/never_suggest'),
    proposedActionId: z.string(),
    patternKey: z.string(),
  }),
  z.object({
    kind: z.literal('panel/correct_action'),
    proposedActionId: z.string(),
    correction: z.string().min(1).max(800),
  }),
  z.object({
    kind: z.literal('panel/correct_finding'),
    findingId: z.string(),
    surface: z.enum(['priority', 'clutter', 'brief', 'memory']),
    correction: z.string().min(1).max(800),
  }),
  z.object({ kind: z.literal('panel/kill_switch'), enabled: z.boolean() }),
  z.object({ kind: z.literal('panel/set_dry_run'), enabled: z.boolean() }),
  z.object({ kind: z.literal('panel/save_preference'), preference: UserPreferenceSchema }),

  // background -> sidepanel
  z.object({ kind: z.literal('bg/scan_complete'), scan: ScanResultSchema }),
  z.object({
    kind: z.literal('bg/classification'),
    clutter: z.array(ClutterFindingSchema),
    groups: z.array(ClutterSenderGroupSchema),
    priorities: z.array(PriorityFindingSchema),
  }),
  z.object({
    kind: z.literal('bg/action_items'),
    items: z.array(ActionItemSchema),
  }),
  z.object({ kind: z.literal('bg/brief'), brief: DailyBriefSchema }),
  z.object({ kind: z.literal('bg/proposed_action'), action: ProposedActionSchema }),
  z.object({ kind: z.literal('bg/memory_suggestion'), suggestion: MemorySuggestionSchema }),
  z.object({ kind: z.literal('bg/ledger_entry'), entry: ActionLedgerEntrySchema }),
  z.object({ kind: z.literal('bg/trace_event'), event: AgentTraceEventSchema }),
  z.object({ kind: z.literal('bg/chat_reply'), text: z.string(), turnId: z.string().optional() }),
  z.object({ kind: z.literal('bg/error'), message: z.string() }),
]);
export type ExtMessage = z.infer<typeof ExtMessageSchema>;

export function parseExtMessage(raw: unknown): ExtMessage | null {
  const r = ExtMessageSchema.safeParse(raw);
  return r.success ? r.data : null;
}
