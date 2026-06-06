import { z } from 'zod';

export const AgentTraceEventKindSchema = z.enum([
  'session_start',
  'session_end',
  'turn_start',
  'turn_end',
  'agent_start',
  'agent_end',
  'agent_handoff',
  'tool_call_start',
  'tool_call_end',
  'classification_batch',
  'approval_requested',
  'approval_granted',
  'approval_rejected',
  'action_executed',
  'action_blocked',
  'error',
]);
export type AgentTraceEventKind = z.infer<typeof AgentTraceEventKindSchema>;

export const AgentTraceEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string().optional(),
  kind: AgentTraceEventKindSchema,
  agent: z.string().optional(),
  tool: z.string().optional(),
  message: z.string().max(800).optional(),
  data: z.record(z.unknown()).default({}),
  at: z.string().datetime(),
  /** ms since turn start, when applicable. */
  elapsedMs: z.number().int().min(0).optional(),
});
export type AgentTraceEvent = z.infer<typeof AgentTraceEventSchema>;
