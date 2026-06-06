import React, { useEffect, useState } from 'react';
import { usePanelStore } from '../state/store';
import { AgentTraceTimeline } from '../cards/AgentTraceTimeline';
import type { ActionLedgerEntry, AgentTraceEvent, ProposedAction } from '@schemas/index';

const ACTIVE_KINDS = new Set<AgentTraceEvent['kind']>([
  'session_start',
  'turn_start',
  'agent_start',
  'agent_handoff',
  'tool_call_start',
  'classification_batch',
]);

const ATTENTION_KINDS = new Set<AgentTraceEvent['kind']>(['approval_requested']);
const ERROR_KINDS = new Set<AgentTraceEvent['kind']>(['error', 'action_blocked']);

const STILL_ACTIVE_WINDOW_MS = 8000;

function humanizeAgent(agent?: string): string {
  if (!agent) return '';
  return agent.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeTool(tool?: string): string {
  if (!tool) return '';
  return tool.replace(/[_-]/g, ' ');
}

function resolveActionTitle(
  event: AgentTraceEvent,
  proposedActions: Record<string, ProposedAction>,
  ledger: ActionLedgerEntry[],
): string | undefined {
  const id =
    (event.data?.['proposedActionId'] as string | undefined) ??
    (event.data?.['actionId'] as string | undefined);
  if (!id) return undefined;
  const proposed = proposedActions[id];
  if (proposed?.title) return proposed.title;
  const entry = ledger.find((e) => e.proposed.id === id);
  return entry?.proposed.title;
}

function describe(
  event: AgentTraceEvent | undefined,
  proposedActions: Record<string, ProposedAction>,
  ledger: ActionLedgerEntry[],
  dryRun: boolean,
): string {
  if (!event) return 'Ready when you are';

  const who = humanizeAgent(event.agent);

  // Action-shaped events deserve a real description ("Done: Unsubscribe from Substack").
  switch (event.kind) {
    case 'action_executed': {
      const title = resolveActionTitle(event, proposedActions, ledger);
      if (title) return dryRun || event.message === 'dry-run skip' ? `Logged (dry run): ${title}` : `Done: ${title}`;
      return dryRun ? 'Logged action (dry run)' : 'Action executed';
    }
    case 'approval_granted': {
      const title = resolveActionTitle(event, proposedActions, ledger);
      return title ? `Approved: ${title}` : 'Approved';
    }
    case 'approval_rejected': {
      const title = resolveActionTitle(event, proposedActions, ledger);
      return title ? `Rejected: ${title}` : 'Rejected';
    }
    case 'action_blocked': {
      const title = resolveActionTitle(event, proposedActions, ledger);
      const reason = event.message ? ` — ${event.message}` : '';
      return title ? `Blocked: ${title}${reason}` : `Action blocked${reason}`;
    }
    case 'approval_requested': {
      const title = resolveActionTitle(event, proposedActions, ledger);
      return title ? `Needs approval: ${title}` : 'Waiting for your approval';
    }
  }

  if (event.message) return event.message;

  switch (event.kind) {
    case 'session_start':
      return 'Starting up…';
    case 'session_end':
      return 'All done';
    case 'turn_start':
      return who ? `${who} is thinking…` : 'Working…';
    case 'turn_end':
      return who ? `${who} finished` : 'Done';
    case 'agent_start':
      return who ? `${who} is on it…` : 'An agent is working…';
    case 'agent_end':
      return who ? `${who} finished` : 'Agent finished';
    case 'agent_handoff':
      return who ? `Handing off to ${who}…` : 'Handing off…';
    case 'tool_call_start':
      return event.tool ? `Running ${humanizeTool(event.tool)}…` : 'Calling a tool…';
    case 'tool_call_end':
      return event.tool ? `${humanizeTool(event.tool)} done` : 'Tool done';
    case 'classification_batch':
      return 'Classifying your messages…';
    case 'error':
      return 'Something went wrong';
    default:
      return event.kind;
  }
}

function relativeTime(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, nowMs - t);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function AgentActivityPanel(): JSX.Element {
  const events = usePanelStore((s) => s.traceEvents);
  const proposedActions = usePanelStore((s) => s.proposedActions);
  const ledger = usePanelStore((s) => s.ledger);
  const dryRun = usePanelStore((s) => s.dryRun);
  const [open, setOpen] = useState(false);
  // tick every few seconds so "X ago" stays fresh and the active state can decay.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 3000);
    return () => clearInterval(id);
  }, []);

  const latest = events[events.length - 1];
  const ageMs = latest ? nowMs - new Date(latest.at).getTime() : Infinity;
  const isFresh = ageMs < STILL_ACTIVE_WINDOW_MS;

  let state: 'idle' | 'working' | 'attention' | 'error' = 'idle';
  if (latest) {
    if (ERROR_KINDS.has(latest.kind)) state = 'error';
    else if (ATTENTION_KINDS.has(latest.kind)) state = 'attention';
    else if (isFresh && ACTIVE_KINDS.has(latest.kind)) state = 'working';
  }

  const message = describe(latest, proposedActions, ledger, dryRun);
  const sub =
    !latest ? 'Click scan to get started'
    : state === 'working' ? 'Working in the background'
    : state === 'attention' ? 'Tap "Today" to review'
    : `Last activity ${relativeTime(latest.at, nowMs)}`;

  return (
    <>
      <section
        className={`pulse ${state}`}
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <div className="pulse-indicator">
          <span className="pulse-ring" />
          <span className="pulse-ring delay" />
          <span className="pulse-core" />
        </div>
        <div className="pulse-content">
          <div className="pulse-message" key={message}>{message}</div>
          <div className="pulse-sub">{sub}</div>
        </div>
        <span className={`pulse-chevron ${open ? 'open' : ''}`}>▾</span>
      </section>
      {open && (
        <div className="pulse-trace">
          <AgentTraceTimeline events={events} grouped={false} />
        </div>
      )}
    </>
  );
}
