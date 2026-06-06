import React from 'react';
import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';
import { usePanelStore } from '../state/store';
import { send } from '../state/bridge';
import { ApprovalActionCard } from '../cards/ApprovalActionCard';
import { EmailPriorityCard } from '../cards/EmailPriorityCard';
import { ClutterSenderGroupCard } from '../cards/ClutterSenderGroupCard';
import { MemorySuggestionCard } from '../cards/MemorySuggestionCard';
import { DailyBriefSection } from '../cards/DailyBriefSection';
import { ActionLedgerTable } from '../cards/ActionLedgerTable';
import { AgentTraceTimeline } from '../cards/AgentTraceTimeline';
import { BatchActionReviewPanel } from '../cards/BatchActionReviewPanel';
import { Skeleton, ErrorState } from '../cards/primitives';
import type { ProposedAction } from '@schemas/index';

/**
 * Register every card component as a CopilotKit generative-UI action so the
 * orchestrating agent can render them directly in chat via tool calls.
 *
 * Naming: `show_<card>` for one-shot renders; the agent supplies the data via
 * arguments. Each render function handles loading and error states so the user
 * sees a meaningful UI for any tool-call status.
 *
 * NOTE: We intentionally use `useCopilotAction` with a plain `render` (not
 * `renderAndWaitForResponse`) for read-only cards. Cards that require user
 * decisions (Approve/Reject, batch confirm) use `renderAndWaitForResponse` so
 * the agent gets the user's choice back.
 */
export function useGenerativeUiBindings(): void {
  const proposedActions = usePanelStore((s) => s.proposedActions);
  const ledger = usePanelStore((s) => s.ledger);
  const traceEvents = usePanelStore((s) => s.traceEvents);
  const removeProposedAction = usePanelStore((s) => s.removeProposedAction);
  const dismissMemorySuggestion = usePanelStore((s) => s.dismissMemorySuggestion);

  // Expose key store slices to the agent as readable context.
  useCopilotReadable({
    description: 'Currently pending proposed actions awaiting user approval.',
    value: Object.values(proposedActions).filter((a) => a.approvalStatus === 'pending'),
  });

  useCopilotReadable({
    description: 'Last 50 ledger entries (audit trail of proposed/approved/executed actions).',
    value: ledger.slice(-50),
  });

  // ── DailyBriefSection ───────────────────────────────────────────────
  useCopilotAction({
    name: 'show_daily_brief_section',
    description:
      'Render one section of the daily brief in chat. Use after summarizing email findings.',
    parameters: [
      {
        name: 'section',
        type: 'object',
        description: 'A DailyBriefSection with kind, title, summary, items, clutterGroups.',
        required: true,
      },
    ],
    render: ({ status, args }) => {
      if (status === 'inProgress') return <Skeleton card lines={4} />;
      const section = args?.section as Parameters<typeof DailyBriefSection>[0]['section'];
      if (!section) return <ErrorState message="Brief section missing." />;
      return (
        <div className="gen-ui-slot">
          <DailyBriefSection section={section} />
        </div>
      );
    },
  });

  // ── EmailPriorityCard ────────────────────────────────────────────────
  useCopilotAction({
    name: 'show_priority_email',
    description: 'Render a single high-priority email finding.',
    parameters: [{ name: 'finding', type: 'object', required: true }],
    render: ({ status, args }) => {
      if (status === 'inProgress') return <Skeleton card />;
      const finding = args?.finding as Parameters<typeof EmailPriorityCard>[0]['finding'];
      if (!finding) return <ErrorState message="Priority finding missing." />;
      return (
        <div className="gen-ui-slot">
          <EmailPriorityCard
            finding={finding}
            onCorrect={(text) =>
              send({
                kind: 'panel/correct_finding',
                findingId: finding.emailId,
                surface: 'priority',
                correction: text,
              })
            }
          />
        </div>
      );
    },
  });

  // ── ClutterSenderGroupCard ──────────────────────────────────────────
  useCopilotAction({
    name: 'show_clutter_sender_group',
    description: 'Render a grouped-clutter-sender card.',
    parameters: [{ name: 'group', type: 'object', required: true }],
    render: ({ status, args }) => {
      if (status === 'inProgress') return <Skeleton card lines={3} />;
      const group = args?.group as Parameters<typeof ClutterSenderGroupCard>[0]['group'];
      if (!group) return <ErrorState message="Sender group missing." />;
      return (
        <div className="gen-ui-slot">
          <ClutterSenderGroupCard
            group={group}
            onCorrect={(text) =>
              send({
                kind: 'panel/correct_finding',
                findingId: group.senderDomain,
                surface: 'clutter',
                correction: text,
              })
            }
          />
        </div>
      );
    },
  });

  // ── MemorySuggestionCard (requires user decision) ───────────────────
  useCopilotAction({
    name: 'propose_memory',
    description:
      'Surface a proposed memory write to the user. Returns "saved" or "discarded" once the user decides.',
    parameters: [{ name: 'suggestion', type: 'object', required: true }],
    renderAndWaitForResponse: ({ status, args, respond }) => {
      if (status === 'inProgress') return <Skeleton card lines={2} />;
      const s = args?.suggestion as Parameters<typeof MemorySuggestionCard>[0]['suggestion'];
      if (!s) return <ErrorState message="Memory suggestion missing." />;
      return (
        <div className="gen-ui-slot">
          <MemorySuggestionCard
            suggestion={s}
            onApprove={() => {
              send({
                kind: 'panel/save_preference',
                preference: {
                  id: s.proposedRecord.id,
                  kind: 'custom',
                  key: s.proposedRecord.summary.slice(0, 40),
                  value: s.suggestion,
                  source: 'agent_suggested_then_approved',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              });
              dismissMemorySuggestion(s.id);
              respond?.('saved');
            }}
            onReject={() => {
              dismissMemorySuggestion(s.id);
              respond?.('discarded');
            }}
            onCorrect={(text) =>
              send({
                kind: 'panel/correct_finding',
                findingId: s.id,
                surface: 'memory',
                correction: text,
              })
            }
          />
        </div>
      );
    },
  });

  // ── ApprovalActionCard (requires user decision) ─────────────────────
  useCopilotAction({
    name: 'request_action_approval',
    description:
      'Render an approval card for a single proposed action and wait for the user. ' +
      'Returns one of: "approve_once", "reject", "always_suggest", "never_suggest".',
    parameters: [{ name: 'action', type: 'object', required: true }],
    renderAndWaitForResponse: ({ status, args, respond }) => {
      if (status === 'inProgress') return <Skeleton card lines={3} />;
      const action = args?.action as ProposedAction | undefined;
      if (!action) return <ErrorState message="Proposed action missing." />;
      const patternKey =
        (action.params?.['senderDomain'] as string | undefined) ??
        (action.params?.['domain'] as string | undefined) ??
        action.type;
      return (
        <div className="gen-ui-slot">
          <ApprovalActionCard
            action={action}
            onApprove={() => {
              send({
                kind: 'panel/approve_action',
                approval: {
                  proposedActionId: action.id,
                  status: 'approved',
                  approvedAt: new Date().toISOString(),
                  approvedBy: 'user',
                },
              });
              removeProposedAction(action.id);
              respond?.('approve_once');
            }}
            onReject={() => {
              send({ kind: 'panel/reject_action', proposedActionId: action.id });
              removeProposedAction(action.id);
              respond?.('reject');
            }}
            onAlwaysSuggest={() => {
              send({
                kind: 'panel/always_suggest',
                proposedActionId: action.id,
                patternKey,
              });
              respond?.('always_suggest');
            }}
            onNeverSuggest={() => {
              send({
                kind: 'panel/never_suggest',
                proposedActionId: action.id,
                patternKey,
              });
              removeProposedAction(action.id);
              respond?.('never_suggest');
            }}
            onCorrect={(text) =>
              send({
                kind: 'panel/correct_action',
                proposedActionId: action.id,
                correction: text,
              })
            }
          />
        </div>
      );
    },
  });

  // ── BatchActionReviewPanel (requires user decision) ─────────────────
  useCopilotAction({
    name: 'request_batch_approval',
    description:
      'Render a batch approval panel for low-risk reversible actions (mark_read/archive only). ' +
      'Returns either "confirmed:<comma-ids>" or "cancelled".',
    parameters: [
      {
        name: 'actions',
        type: 'object[]',
        description: 'Array of ProposedAction. Non-batchable items are surfaced as ineligible.',
        required: true,
      },
    ],
    renderAndWaitForResponse: ({ status, args, respond }) => {
      if (status === 'inProgress') return <Skeleton card lines={4} />;
      const actions = (args?.actions as ProposedAction[] | undefined) ?? [];
      if (actions.length === 0) return <ErrorState message="No actions provided." />;
      return (
        <div className="gen-ui-slot">
          <BatchActionReviewPanel
            actions={actions}
            onConfirm={(ids) => {
              send({
                kind: 'panel/batch_approve',
                proposedActionIds: ids,
                confirmedAt: new Date().toISOString(),
              });
              ids.forEach(removeProposedAction);
              respond?.(`confirmed:${ids.join(',')}`);
            }}
            onCancel={() => respond?.('cancelled')}
          />
        </div>
      );
    },
  });

  // ── ActionLedgerTable ────────────────────────────────────────────────
  useCopilotAction({
    name: 'show_action_ledger',
    description: 'Render the audit-trail ledger of recent actions.',
    parameters: [
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum entries to show (default 25).',
        required: false,
      },
    ],
    render: ({ status, args }) => {
      if (status === 'inProgress') return <Skeleton lines={6} />;
      const limit = (args?.limit as number | undefined) ?? 25;
      return (
        <div className="gen-ui-slot">
          <ActionLedgerTable entries={ledger.slice(-limit)} />
        </div>
      );
    },
  });

  // ── AgentTraceTimeline ───────────────────────────────────────────────
  useCopilotAction({
    name: 'show_agent_trace',
    description: 'Render the most recent agent trace events, grouped by agent.',
    parameters: [
      { name: 'limit', type: 'number', required: false },
    ],
    render: ({ status, args }) => {
      if (status === 'inProgress') return <Skeleton lines={4} />;
      const limit = (args?.limit as number | undefined) ?? 30;
      return (
        <div className="gen-ui-slot">
          <AgentTraceTimeline events={traceEvents} limit={limit} grouped />
        </div>
      );
    },
  });
}
