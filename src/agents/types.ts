import { z } from 'zod';
import {
  ApprovalRecordSchema,
  ClutterFindingSchema,
  EmailCandidateSchema,
  ProposedActionSchema,
  PriorityFindingSchema,
  UserPreferenceSchema,
  ActionLedgerEntrySchema,
} from '@schemas/index';

/**
 * Production-quality interfaces shared by every agent boundary.
 *
 * Why a separate module:
 *  - `agent-defs.ts` describes WHO each agent is (prompt, responsibilities, tools).
 *  - `types.ts` (this file) describes the WIRE FORMAT between agents — the typed
 *    payloads handed off, the result envelope, the policy verdict, the user
 *    approval verdict. Both the in-extension orchestrator and the
 *    server-side multi-agent runner consume these.
 *
 * Keep this file free of Node- or Chrome-specific imports so it stays loadable
 * from the service worker, the side panel, the sidecar, and the evals.
 */

// ---------------- Handoff payloads ----------------

export const AgentHandoffKindSchema = z.enum([
  'classify_clutter',
  'classify_priority',
  'recall_memory',
  'validate_action',
  'request_approval',
  'execute_unsubscribe',
  'log_audit',
  'compose_brief',
  'normalize_candidates',
]);
export type AgentHandoffKind = z.infer<typeof AgentHandoffKindSchema>;

/**
 * Discriminated by `kind` so each handoff carries a strongly-typed payload.
 * Lives on the wire in two places:
 *  - inside AgentTraceEvent.data when we emit an `agent_handoff` trace, and
 *  - as the input to the next agent's run() call.
 */
export const AgentHandoffPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('normalize_candidates'),
    fromAgent: z.string(),
    toAgent: z.string(),
    turnId: z.string(),
    createdAt: z.string().datetime(),
    candidates: z.array(EmailCandidateSchema),
  }),
  z.object({
    kind: z.literal('classify_clutter'),
    fromAgent: z.string(),
    toAgent: z.string(),
    turnId: z.string(),
    createdAt: z.string().datetime(),
    batchIndex: z.number().int().min(0),
    batchCount: z.number().int().min(1),
    candidates: z.array(EmailCandidateSchema),
    preferences: z.array(UserPreferenceSchema).default([]),
  }),
  z.object({
    kind: z.literal('classify_priority'),
    fromAgent: z.string(),
    toAgent: z.string(),
    turnId: z.string(),
    createdAt: z.string().datetime(),
    batchIndex: z.number().int().min(0),
    batchCount: z.number().int().min(1),
    candidates: z.array(EmailCandidateSchema),
    preferences: z.array(UserPreferenceSchema).default([]),
  }),
  z.object({
    kind: z.literal('recall_memory'),
    fromAgent: z.string(),
    toAgent: z.string(),
    turnId: z.string(),
    createdAt: z.string().datetime(),
    userId: z.string(),
  }),
  z.object({
    kind: z.literal('validate_action'),
    fromAgent: z.string(),
    toAgent: z.string(),
    turnId: z.string(),
    createdAt: z.string().datetime(),
    action: ProposedActionSchema,
  }),
  z.object({
    kind: z.literal('request_approval'),
    fromAgent: z.string(),
    toAgent: z.string(),
    turnId: z.string(),
    createdAt: z.string().datetime(),
    action: ProposedActionSchema,
  }),
  z.object({
    kind: z.literal('execute_unsubscribe'),
    fromAgent: z.string(),
    toAgent: z.string(),
    turnId: z.string(),
    createdAt: z.string().datetime(),
    action: ProposedActionSchema,
    approval: ApprovalRecordSchema,
  }),
  z.object({
    kind: z.literal('log_audit'),
    fromAgent: z.string(),
    toAgent: z.string(),
    turnId: z.string(),
    createdAt: z.string().datetime(),
    proposedActionId: z.string(),
    outcome: z.enum(['approved', 'rejected', 'blocked', 'executed', 'failed']),
    detail: z.string().max(800).optional(),
    entry: ActionLedgerEntrySchema.optional(),
  }),
  z.object({
    kind: z.literal('compose_brief'),
    fromAgent: z.string(),
    toAgent: z.string(),
    turnId: z.string(),
    createdAt: z.string().datetime(),
    clutter: z.array(ClutterFindingSchema),
    priorities: z.array(PriorityFindingSchema),
  }),
]);
export type AgentHandoffPayload = z.infer<typeof AgentHandoffPayloadSchema>;

// ---------------- Context shared across one orchestrator turn ----------------

import type { UserPreference } from '@schemas/index';

export interface AgentContext {
  turnId: string;
  sessionId: string;
  userId: string;
  dryRun: boolean;
  killSwitch: boolean;
  preferences: UserPreference[];
  /** Optional source tab id for content-script dispatch. */
  sourceTabId?: number;
}

// ---------------- Run envelope ----------------

export interface AgentRunResult<T = unknown> {
  agent: string;
  ok: boolean;
  output?: T;
  error?: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  /** Handoffs this agent emitted to other agents during the run. */
  handoffs: AgentHandoffPayload[];
}

export interface AgentToolResult<T = unknown> {
  tool: string;
  agent: string;
  ok: boolean;
  output?: T;
  error?: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
}

// ---------------- Policy + Approval verdicts ----------------

export const PolicyDecisionSchema = z.object({
  allow: z.boolean(),
  /** Short, deterministic reason ("forbidden_action_type", "permission_mismatch", …). */
  ruleId: z.string().optional(),
  /** Human-readable explanation surfaced in traces + UI. */
  reason: z.string().optional(),
  actionId: z.string(),
  decidedBy: z.string(),
  decidedAt: z.string().datetime(),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const ApprovalDecisionSchema = z.object({
  proposedActionId: z.string(),
  status: z.enum(['approved', 'rejected', 'pending', 'expired']),
  approvedBy: z.string().default('user'),
  approvedAt: z.string().datetime(),
  note: z.string().max(400).optional(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
