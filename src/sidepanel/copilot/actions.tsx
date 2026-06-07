import React from 'react';
import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';
import { usePanelStore } from '../state/store';
import { send } from '../state/bridge';
import { ApprovalActionCard } from '../cards/ApprovalActionCard';
import { DecisionCard } from '../cards/DecisionCard';
import { PaymentRemindersCard } from '../cards/PaymentRemindersCard';
import { EmailPriorityCard } from '../cards/EmailPriorityCard';
import { ClutterSenderGroupCard } from '../cards/ClutterSenderGroupCard';
import { MemorySuggestionCard } from '../cards/MemorySuggestionCard';
import { DailyBriefSection } from '../cards/DailyBriefSection';
import { ActionLedgerTable } from '../cards/ActionLedgerTable';
import { AgentTraceTimeline } from '../cards/AgentTraceTimeline';
import { BatchActionReviewPanel } from '../cards/BatchActionReviewPanel';
import { Skeleton, ErrorState } from '../cards/primitives';
import { normalizeProposedAction, isActionType, type LooseAction } from '@agents/action-factory';
import type { Decision, ProposedAction } from '@schemas/index';
import { nanoid } from 'nanoid';

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
 *
 * IMPORTANT: read-only display actions must use `available: 'enabled'`, NOT
 * `'frontend'`. In CopilotKit 1.59.5 `getActionConfig` maps `'enabled'`/`'remote'`
 * → a frontend tool that is advertised to the model AND renders, whereas
 * `'frontend'`/`'disabled'` → render-only (passive; never sent to the LLM, so the
 * agent never calls it and no card ever renders). Do not "simplify" by deleting
 * `available` either — an action with no handler and no `renderAndWaitForResponse`
 * then throws "Invalid action configuration". See issue #49.
 */
/** Mirrors the useCopilotAction names registered below — dev log only (#73). */
const GEN_UI_TOOL_NAMES = [
  'show_decisions',
  'show_payment_reminders',
  'show_daily_brief_section',
  'show_priority_email',
  'show_clutter_sender_group',
  'propose_memory',
  'request_action_approval',
  'request_batch_approval',
  'show_action_ledger',
  'show_agent_trace',
] as const;

/** Module-level guard so the dev tool-list log fires once, not per re-render. */
let loggedToolsOnce = false;

export function useGenerativeUiBindings(): void {
  const proposedActions = usePanelStore((s) => s.proposedActions);
  const ledger = usePanelStore((s) => s.ledger);
  const traceEvents = usePanelStore((s) => s.traceEvents);
  const decisions = usePanelStore((s) => s.decisions);
  const removeProposedAction = usePanelStore((s) => s.removeProposedAction);
  const dismissMemorySuggestion = usePanelStore((s) => s.dismissMemorySuggestion);

  // Shared "open the best target for a decision" behavior (link → thread → row
  // highlight), used by both the decisions list and the payments panel.
  const openDecision = (decision: Decision) => {
    if (decision.actionUrl) {
      window.open(decision.actionUrl, '_blank', 'noopener,noreferrer');
    } else if (decision.threadLocator || decision.rowSelector) {
      send({
        kind: 'panel/open_thread',
        locator: decision.threadLocator ?? null,
        fallbackSelector: decision.rowSelector ?? null,
      });
    }
  };

  // Dev triage for #73: log once which gen-UI tools this bundle advertises, with
  // the build stamp. Answers "does the running bundle even know about
  // show_payment_reminders?" without grepping dist/assets/*.js. Keep this list
  // in sync with the useCopilotAction registrations below.
  React.useEffect(() => {
    if (loggedToolsOnce) return;
    loggedToolsOnce = true;
    const build = typeof __BUILD_TIMESTAMP__ === 'string' ? __BUILD_TIMESTAMP__ : 'unknown';
    console.info(`[email-signal] gen-UI tools (build ${build}):`, GEN_UI_TOOL_NAMES.join(', '));
  }, []);

  // Expose key store slices to the agent as readable context.
  useCopilotReadable({
    description:
      "Today's synthesized decisions — the short list of things the user must act on, " +
      'each folding one or more emails. This is the product output; prefer answering ' +
      'inbox questions from here rather than restating raw emails.',
    value: decisions,
  });

  useCopilotReadable({
    description: 'Currently pending proposed actions awaiting user approval.',
    value: Object.values(proposedActions).filter((a) => a.approvalStatus === 'pending'),
  });

  // ── DecisionCard list ───────────────────────────────────────────────
  useCopilotAction({
    name: 'show_decisions',
    description:
      "Render the user's synthesized decisions as cards in chat. Omit `decisions` to " +
      'show the current Today list.',
    available: 'enabled',
    parameters: [{ name: 'decisions', type: 'object[]', required: false }],
    render: ({ status, args }) => {
      if (status === 'inProgress') return <Skeleton card lines={2} />;
      const list = ((args?.decisions as Decision[] | undefined) ?? decisions) || [];
      if (list.length === 0) return <ErrorState message="Nothing pressing today." />;
      return (
        <div className="gen-ui-slot">
          {list.map((d) => (
            <DecisionCard
              key={d.id}
              decision={d}
              // Same open-link-else-thread behavior as the Today tab (#31).
              onPrimary={openDecision}
              onHighlight={(selector) => send({ kind: 'panel/highlight', selector })}
              // Wire the same dispositions the Today tab uses so Snooze /
              // Mark handled / "Not for me" actually do something in chat too
              // (issue #30). Removing the card from the transcript isn't
              // possible here, but the messages still fire and persist.
              onHandled={() => {
                send({
                  kind: 'panel/decision_action',
                  action: 'handled',
                  decisionId: d.id,
                  emailIds: d.emailIds,
                });
              }}
              onSnooze={() => {
                send({
                  kind: 'panel/decision_action',
                  action: 'snooze',
                  decisionId: d.id,
                  emailIds: d.emailIds,
                  untilMs: Date.now() + 24 * 60 * 60 * 1000,
                });
              }}
              onCorrect={(text) =>
                send({
                  kind: 'panel/correct_finding',
                  findingId: d.id,
                  surface: 'priority',
                  correction: text,
                })
              }
            />
          ))}
        </div>
      );
    },
  });

  // ── PaymentRemindersCard ────────────────────────────────────────────
  useCopilotAction({
    name: 'show_payment_reminders',
    description:
      "Render the user's bills/payments as a dedicated reminders panel (amount, payee, " +
      'deadline, total outstanding, most-overdue first) — prefer this over show_decisions ' +
      'whenever the user asks about money, bills, invoices, or payments. Takes no arguments: ' +
      "it always renders the user's actual money-themed decisions from Today, never a " +
      'model-curated subset (see issue #73).',
    available: 'enabled',
    // No parameter: an untyped `object[]` passthrough let the model hallucinate
    // a shape or smuggle non-money items past the filter. This card is, by
    // definition, the bills surface — it reads the real Today list and keeps
    // only money decisions, always (#73).
    parameters: [],
    render: ({ status }) => {
      if (status === 'inProgress') return <Skeleton card lines={3} />;
      const list = (decisions ?? []).filter((d) => d.theme === 'money');
      if (list.length === 0) return <ErrorState message="No payment reminders right now." />;
      return (
        <div className="gen-ui-slot">
          <PaymentRemindersCard
            decisions={list}
            onPay={openDecision}
            onMarkPaid={(d) =>
              send({
                kind: 'panel/decision_action',
                action: 'handled',
                decisionId: d.id,
                emailIds: d.emailIds,
              })
            }
            onSnooze={(d) =>
              send({
                kind: 'panel/decision_action',
                action: 'snooze',
                decisionId: d.id,
                emailIds: d.emailIds,
                untilMs: Date.now() + 24 * 60 * 60 * 1000,
              })
            }
            onCorrect={(decisionId, text) =>
              send({
                kind: 'panel/correct_finding',
                findingId: decisionId,
                surface: 'priority',
                correction: text,
              })
            }
          />
        </div>
      );
    },
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
    available: 'enabled',
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
    available: 'enabled',
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
    available: 'enabled',
    parameters: [{ name: 'group', type: 'object', required: true }],
    render: ({ status, args }) => {
      if (status === 'inProgress') return <Skeleton card lines={3} />;
      const group = args?.group as Parameters<typeof ClutterSenderGroupCard>[0]['group'];
      if (!group) return <ErrorState message="Sender group missing." />;
      return (
        <div className="gen-ui-slot">
          <ClutterSenderGroupCard
            group={group}
            onIgnore={() =>
              send({
                kind: 'panel/save_preference',
                preference: {
                  id: nanoid(),
                  kind: 'ignored_sender',
                  key: group.senderDomain.toLowerCase(),
                  value: group.senderDomain.toLowerCase(),
                  source: 'agent_suggested_then_approved',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              })
            }
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
      'Render an approval card for ONE action you want to take on the inbox and WAIT for the ' +
      'user. Use this for any real action (open_email, mark_read, archive, click_unsubscribe) — ' +
      'never claim in plain text that you opened/marked/archived anything; you must go through ' +
      'this card. Pass `action` as { type, decisionId, title, rationale }. `decisionId` must be ' +
      "the id of one of Today's decisions (so the app can locate the email); the app fills in " +
      'risk, reversibility and the Gmail selector for you. ' +
      'Returns one of: "approve_once", "reject", "always_suggest", "never_suggest".',
    parameters: [{ name: 'action', type: 'object', required: true }],
    renderAndWaitForResponse: ({ status, args, respond }) => {
      if (status === 'inProgress') return <Skeleton card lines={3} />;
      const raw = args?.action as (LooseAction & { decisionId?: string }) | undefined;
      if (!raw || !isActionType(raw.type)) {
        return <ErrorState message="I couldn't build a valid action for that." />;
      }
      // The model supplies a loose shape; normalize it into a gate-valid action
      // with a real risk level and a Gmail selector resolved from the decision.
      let action: ProposedAction;
      try {
        const loose: LooseAction = raw.decisionId
          ? { ...raw, params: { ...(raw.params ?? {}), decisionId: raw.decisionId } }
          : raw;
        action = normalizeProposedAction(loose, decisions);
      } catch {
        return <ErrorState message="I couldn't build a valid action for that." />;
      }
      const patternKey =
        (action.params?.['senderDomain'] as string | undefined) ??
        (action.params?.['domain'] as string | undefined) ??
        action.type;
      return (
        <div className="gen-ui-slot">
          <ApprovalActionCard
            action={action}
            onApprove={() => {
              // Chat-proposed actions aren't in the ledger yet — execute_action
              // records, gates, runs and logs the whole thing in the background.
              send({ kind: 'panel/execute_action', action });
              removeProposedAction(action.id);
              respond?.('approved — running it now; the result will show in your activity log.');
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
    available: 'enabled',
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
    available: 'enabled',
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
