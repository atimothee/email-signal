import React, { useEffect, useState } from 'react';
import { usePanelStore } from '../state/store';
import { AgentTraceTimeline } from '../cards/AgentTraceTimeline';
import type { ActionLedgerEntry, AgentTraceEvent, ProposedAction } from '@schemas/index';

const ATTENTION_KINDS = new Set<AgentTraceEvent['kind']>(['approval_requested']);
const ERROR_KINDS = new Set<AgentTraceEvent['kind']>(['error', 'action_blocked']);

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
  if (!event) return 'Standing by';

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
  const scanStatus = usePanelStore((s) => s.scanStatus);
  const scanProgress = usePanelStore((s) => s.scanProgress);
  const decisions = usePanelStore((s) => s.decisions);
  const [open, setOpen] = useState(false);
  // tick every few seconds so "X ago" stays fresh and the active state can decay.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 3000);
    return () => clearInterval(id);
  }, []);

  const latest = events[events.length - 1];
  const pendingCount = Object.values(proposedActions).filter(
    (a) => a.approvalStatus === 'pending'
  ).length;

  // The pulse follows the REAL lifecycle (scanStatus), not the raw trace tail —
  // so it never says "All done" while the next batch is still running.
  let state: 'idle' | 'working' | 'attention' | 'error' = 'idle';
  let message: string;
  let sub: string;

  if (scanStatus === 'error') {
    state = 'error';
    message = 'Something went wrong';
    sub = 'Open the timeline below for details';
  } else if (scanStatus === 'reading') {
    state = 'working';
    message = 'Reading your inbox…';
    sub = scanProgress.target
      ? `Loaded ${scanProgress.loaded} of ~${scanProgress.target} emails`
      : `Loaded ${scanProgress.loaded} emails`;
  } else if (scanStatus === 'thinking') {
    state = 'working';
    message = 'Figuring out what matters…';
    sub = 'Reading between the lines of your inbox';
  } else if (pendingCount > 0) {
    state = 'attention';
    message = pendingCount === 1 ? '1 thing waiting for your approval' : `${pendingCount} things waiting for your approval`;
    sub = 'Tap "Today" to review';
  } else if (scanStatus === 'done') {
    state = 'idle';
    // Honest "work done on your behalf" — the real count we actually read this
    // run, paired with the outcome. Replaces the debug line in App.tsx.
    const read =
      scanProgress.loaded > 0
        ? `Read ${scanProgress.loaded} email${scanProgress.loaded === 1 ? '' : 's'}`
        : '';
    if (decisions.length) {
      message = `${decisions.length} decision${decisions.length === 1 ? '' : 's'} for you today`;
      sub = read ? `${read} · tap "Today" to see them` : 'Tap "Today" to see them';
    } else {
      message = 'All clear — nothing pressing';
      sub = read ? `${read} · nothing needs you` : 'I read your inbox and found no to-dos';
    }
  } else {
    // Idle / first run — fall back to the latest trace in plain language.
    if (latest && ERROR_KINDS.has(latest.kind)) state = 'error';
    else if (latest && ATTENTION_KINDS.has(latest.kind)) state = 'attention';
    message = describe(latest, proposedActions, ledger, dryRun);
    sub = latest ? `Last activity ${relativeTime(latest.at, nowMs)}` : 'Your inbox activity shows up here';
  }

  // The timeline only earns a disclosure affordance when there's something to
  // show — otherwise a click reveals an empty box (the confusing part).
  const hasTimeline = events.length > 0;
  // Recede when idle and nothing has happened for a while: calmer + smaller,
  // never absent, and never while expanded. Working/attention/error stay full.
  const lastAgeMs = latest ? nowMs - new Date(latest.at).getTime() : Infinity;
  const recede = state === 'idle' && !open && lastAgeMs > 25_000;

  const toggle = () => hasTimeline && setOpen((v) => !v);

  return (
    <>
      <section
        className={`pulse ${state} ${recede ? 'idle-compact' : ''}`}
        onClick={toggle}
        role={hasTimeline ? 'button' : undefined}
        aria-expanded={hasTimeline ? open : undefined}
        tabIndex={hasTimeline ? 0 : undefined}
        onKeyDown={(e) => {
          if (hasTimeline && (e.key === 'Enter' || e.key === ' ')) {
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
          {!recede && <div className="pulse-sub">{sub}</div>}
        </div>
        {hasTimeline && (
          <span className={`pulse-toggle ${open ? 'open' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 6l4 4 4-4" />
            </svg>
            {open ? 'Hide' : 'Activity'}
          </span>
        )}
      </section>
      {open && hasTimeline && (
        <div className="pulse-trace">
          <AgentTraceTimeline events={events} grouped={false} />
        </div>
      )}
    </>
  );
}
