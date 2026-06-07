/**
 * Agent definitions for the multi-agent EmailSignal system.
 *
 * Each agent has:
 *  - `name`             — stable identifier used in traces, ledger, and handoffs.
 *  - `instructions`     — system prompt fed to the model when the agent runs.
 *  - `responsibilities` — short bullet contract; mirrored into prompts + docs.
 *  - `allowedTools`     — exclusive whitelist of tool names this agent may call.
 *  - `disallowedTools`  — explicit denials, also enforced as a second gate so
 *                         that prompt drift can't quietly grant new capabilities.
 *  - `handoffsTo`       — typed handoff kinds this agent may emit. Used by the
 *                         orchestrator to wire the SDK's `handoffs:` array.
 *
 * The orchestrator is the only agent that may produce handoffs; classifier and
 * executor agents return structured payloads to the orchestrator, which then
 * routes further work. This keeps the topology explicit and auditable.
 */

import type { AgentHandoffKind } from './types.js';

export const AGENT_NAMES = {
  orchestrator: 'OrchestratorAgent',
  inboxScanner: 'InboxScannerAgent',
  clutter: 'ClutterClassifierAgent',
  priority: 'PriorityClassifierAgent',
  memory: 'MemoryAgent',
  policy: 'ActionPolicyAgent',
  unsubscribe: 'UnsubscribeAgent',
  brief: 'DailyBriefAgent',
  audit: 'AuditLedgerAgent',
} as const;

export type AgentName = (typeof AGENT_NAMES)[keyof typeof AGENT_NAMES];

export type ToolName =
  | 'list_clutter_findings'
  | 'list_priority_findings'
  | 'propose_action'
  | 'validate_action'
  | 'recall_memory'
  | 'propose_memory'
  | 'query_ledger'
  | 'append_ledger'
  | 'highlight_email'
  | 'normalize_candidates'
  | 'dom_open_link';

export interface AgentSpec {
  name: AgentName;
  instructions: string;
  responsibilities: string[];
  allowedTools: ToolName[];
  disallowedTools: ToolName[];
  handoffsTo: AgentHandoffKind[];
}

export const INSTRUCTIONS: Record<AgentName, string> = {
  [AGENT_NAMES.orchestrator]: `You are the EmailSignal Orchestrator — a router, not an executor.
You NEVER call DOM tools, NEVER write memory, NEVER append the ledger directly.
You plan turns and hand off to the right specialist:
  - InboxScannerAgent for raw candidate normalization
  - MemoryAgent FIRST to recall preferences that should influence ranking
  - ClutterClassifierAgent and PriorityClassifierAgent in parallel batches
  - ActionPolicyAgent to vet every proposed action BEFORE the user sees it
  - UnsubscribeAgent only after the user has explicitly approved
  - AuditLedgerAgent after every approved action attempt, success OR failure
  - DailyBriefAgent for the user-facing synthesis
Safety rules:
- Never propose delete / send / forward / reply actions.
- Never invoke an external action without a ProposedAction approved by user + policy.
- If the user's question is purely conversational, answer without proposing a DOM action.`,

  [AGENT_NAMES.inboxScanner]: `You take a raw list of EmailCandidates from the Gmail DOM
and normalize them: dedupe by id, fill sender_domain, strip tracking pixels from snippets.
You do NOT classify intent — that is the clutter and priority agents' job. Return
{candidates: EmailCandidate[]}.`,

  [AGENT_NAMES.clutter]: `You identify CLUTTER: bulk, automated, or promotional mail —
newsletters, marketing, promotions, cold outreach, automated notifications, social
updates, receipts/confirmations. For each clutter email return a ClutterFinding with a
ClutterCategory, confidence, a one-sentence rationale, and a suggested action
(unsubscribe, mark_read, archive, label, open_only, ignore). Only unsubscribe is irreversible.
CRITICAL: if an email looks like a REAL PERSON writing to a human (a personal note, a
direct question, a reply someone is waiting on), it is NOT clutter — DO NOT include it.
When unsure whether something is personal, leave it OUT rather than mislabeling it.
Return ONLY clutter in {findings: ClutterFinding[]}; omit everything else. You do not
propose actions — the orchestrator routes those through UnsubscribeAgent + ActionPolicyAgent.`,

  [AGENT_NAMES.priority]: `You identify emails that may need user attention: payment
reminders, bills, scheduling, recruiter/job, replies needed, family/personal, deadlines,
travel. Extract dueAt when possible (ISO date). Provide an "ask" sentence the user can
act on. Bias toward fewer, higher-confidence picks.
Always weight the user's stored preferences (passed in as context) — an
'important_sender' should push priority up, an 'ignored_sender' should never appear.
Return {findings: PriorityFinding[]}.`,

  [AGENT_NAMES.memory]: `You manage user memory. When the orchestrator calls you BEFORE
prioritization, return the relevant UserPreferences and MemoryRecords for this user
so downstream agents can use them. When proposing a NEW memory record, return a
MemorySuggestion — never silently write it. Sensitive preferences (about people,
finances, health) MUST come back as suggestions with a clear confirmation card.`,

  [AGENT_NAMES.policy]: `You are the safety gate. For every proposed action validate:
- proposed_by must be a known agent
- requiredPermission matches the action type
- risk is set appropriately (click_unsubscribe: medium; mark_read/archive: low; suggest_label: none)
- reversible flag is correct
- approval_status starts as 'pending' unless required_permission is 'memory_write' against
  a previously-approved memory
Block any action that touches delete/send/forward semantics.
Return a PolicyDecision with {allow, ruleId, reason}. This verdict is advisory;
the deterministic checkPolicy() function is the final hard gate the orchestrator
runs after you respond.`,

  [AGENT_NAMES.unsubscribe]: `You execute APPROVED unsubscribe workflows only. Steps:
1. Confirm the handoff payload includes an approved ApprovalRecord and a ProposedAction
   of type click_unsubscribe.
2. Validate the href is HTTPS and matches the sender domain or a well-known ESP domain.
3. Hand off to the dom_open_link tool. Never submit forms on the destination page.
4. Return the executed result envelope so AuditLedgerAgent can record it.
You never delete emails or enter credentials.`,

  [AGENT_NAMES.brief]: `You synthesize the Daily Brief. Sections, in order:
Needs reply, Money/payment reminders, Scheduling/logistics, Job/career, FYI but important,
Clutter cleanup opportunities. Keep the headline under 280 chars and each section summary
under 800 chars. Include actionable buttons by referencing ProposedAction ids.`,

  [AGENT_NAMES.audit]: `You answer ledger queries: "what did you do today/this week",
"show all unsubscribes", "undo last reversible action". You also receive log_audit
handoffs from the orchestrator after every approved action — success or failure —
and you append the ExecutedAction result to the ledger. You never invent actions:
you only summarize what is in the ledger and offer to propose new actions to
reverse reversible ones.`,
};

export const AGENT_REGISTRY: Record<AgentName, AgentSpec> = {
  [AGENT_NAMES.orchestrator]: {
    name: AGENT_NAMES.orchestrator,
    instructions: INSTRUCTIONS[AGENT_NAMES.orchestrator],
    responsibilities: [
      'Plan each turn end-to-end',
      'Recall preferences via MemoryAgent before classification',
      'Fan out parallel clutter + priority batches',
      'Route every proposed action through ActionPolicyAgent',
      'Surface approval cards to the user; never act without explicit approval',
      'Log every approved action attempt (success OR failure) via AuditLedgerAgent',
    ],
    allowedTools: [],
    disallowedTools: [
      'list_clutter_findings',
      'list_priority_findings',
      'propose_action',
      'validate_action',
      'recall_memory',
      'propose_memory',
      'query_ledger',
      'append_ledger',
      'highlight_email',
      'normalize_candidates',
      'dom_open_link',
    ],
    handoffsTo: [
      'normalize_candidates',
      'recall_memory',
      'classify_clutter',
      'classify_priority',
      'validate_action',
      'request_approval',
      'execute_unsubscribe',
      'log_audit',
      'compose_brief',
    ],
  },

  [AGENT_NAMES.inboxScanner]: {
    name: AGENT_NAMES.inboxScanner,
    instructions: INSTRUCTIONS[AGENT_NAMES.inboxScanner],
    responsibilities: ['Dedupe', 'Strip tracking pixels', 'Fill sender domain'],
    allowedTools: ['normalize_candidates'],
    disallowedTools: [
      'propose_action',
      'validate_action',
      'dom_open_link',
      'append_ledger',
      'propose_memory',
    ],
    handoffsTo: [],
  },

  [AGENT_NAMES.clutter]: {
    name: AGENT_NAMES.clutter,
    instructions: INSTRUCTIONS[AGENT_NAMES.clutter],
    responsibilities: [
      'Classify each candidate into a ClutterCategory',
      'Suggest an action per finding (no proposing)',
      'Process batches in parallel',
    ],
    allowedTools: ['list_clutter_findings'],
    disallowedTools: [
      'propose_action',
      'dom_open_link',
      'append_ledger',
      'propose_memory',
    ],
    handoffsTo: [],
  },

  [AGENT_NAMES.priority]: {
    name: AGENT_NAMES.priority,
    instructions: INSTRUCTIONS[AGENT_NAMES.priority],
    responsibilities: [
      'Identify priority emails (payment, scheduling, job, family, etc.)',
      'Respect user preferences passed in context',
      'Extract dueAt when present',
    ],
    allowedTools: ['list_priority_findings', 'recall_memory'],
    disallowedTools: [
      'propose_action',
      'dom_open_link',
      'append_ledger',
      'propose_memory',
    ],
    handoffsTo: [],
  },

  [AGENT_NAMES.memory]: {
    name: AGENT_NAMES.memory,
    instructions: INSTRUCTIONS[AGENT_NAMES.memory],
    responsibilities: [
      'Recall preferences and prior interaction patterns',
      'Surface NEW memory records as suggestions, never silently write',
    ],
    allowedTools: ['recall_memory', 'propose_memory'],
    disallowedTools: [
      'propose_action',
      'dom_open_link',
      'append_ledger',
    ],
    handoffsTo: [],
  },

  [AGENT_NAMES.policy]: {
    name: AGENT_NAMES.policy,
    instructions: INSTRUCTIONS[AGENT_NAMES.policy],
    responsibilities: [
      'Return a PolicyDecision for any proposed action',
      'Block delete / send / forward / reply semantics',
      'Enforce permission-vs-type and risk-vs-type consistency',
    ],
    allowedTools: ['validate_action'],
    disallowedTools: [
      'propose_action',
      'dom_open_link',
      'append_ledger',
      'recall_memory',
      'propose_memory',
    ],
    handoffsTo: [],
  },

  [AGENT_NAMES.unsubscribe]: {
    name: AGENT_NAMES.unsubscribe,
    instructions: INSTRUCTIONS[AGENT_NAMES.unsubscribe],
    responsibilities: [
      'Execute approved click_unsubscribe ProposedActions',
      'Validate HTTPS + domain on the unsubscribe href',
      'Return executed result for ledger logging',
    ],
    allowedTools: ['dom_open_link'],
    disallowedTools: [
      'propose_action',
      'append_ledger',
      'propose_memory',
      'validate_action',
    ],
    handoffsTo: [],
  },

  [AGENT_NAMES.brief]: {
    name: AGENT_NAMES.brief,
    instructions: INSTRUCTIONS[AGENT_NAMES.brief],
    responsibilities: ['Synthesize the Daily Brief from classifier outputs and the ledger'],
    allowedTools: ['query_ledger'],
    disallowedTools: [
      'propose_action',
      'dom_open_link',
      'append_ledger',
      'propose_memory',
    ],
    handoffsTo: [],
  },

  [AGENT_NAMES.audit]: {
    name: AGENT_NAMES.audit,
    instructions: INSTRUCTIONS[AGENT_NAMES.audit],
    responsibilities: [
      'Append every approved action attempt to the ledger',
      'Answer ledger queries faithfully — never invent entries',
    ],
    allowedTools: ['query_ledger', 'append_ledger'],
    disallowedTools: [
      'propose_action',
      'dom_open_link',
      'propose_memory',
      'validate_action',
    ],
    handoffsTo: [],
  },
};

/**
 * Enforces both the allowed-list and the disallowed-list at call sites that
 * dynamically pick a tool. Returns true when the agent is permitted to use the
 * named tool.
 */
export function canAgentUseTool(agent: AgentName, tool: ToolName): boolean {
  const spec = AGENT_REGISTRY[agent];
  if (!spec) return false;
  if (spec.disallowedTools.includes(tool)) return false;
  return spec.allowedTools.includes(tool);
}
