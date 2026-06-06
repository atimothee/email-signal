import React from 'react';
import type { AgentTraceEvent } from '@schemas/index';

interface Props {
  events: AgentTraceEvent[];
  limit?: number;
  /** Group consecutive events by (turnId, agent) for a tidier story. */
  grouped?: boolean;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString().slice(0, 8);
}

function humanize(s?: string): string {
  if (!s) return '';
  return s.replace(/[_-]/g, ' ');
}

export function AgentTraceTimeline({ events, limit = 80, grouped = true }: Props): JSX.Element {
  const slice = events.slice(-limit).reverse();
  if (slice.length === 0) {
    return (
      <div className="faint" style={{ padding: '4px 0' }}>
        No activity yet.
      </div>
    );
  }

  if (!grouped) {
    return (
      <>
        {slice.map((e) => (
          <Event key={e.id} e={e} />
        ))}
      </>
    );
  }

  // Group by agent + turn for readable phases.
  const groups: Array<{ key: string; agent?: string; turnId?: string; events: AgentTraceEvent[] }> = [];
  for (const e of slice) {
    const key = `${e.turnId ?? 'global'}::${e.agent ?? 'system'}`;
    const top = groups[groups.length - 1];
    if (top && top.key === key) top.events.push(e);
    else groups.push({ key, agent: e.agent, turnId: e.turnId, events: [e] });
  }

  return (
    <>
      {groups.map((g) => (
        <div key={g.key} className="trace-group">
          <div className="trace-group-header">
            {g.agent ? humanize(g.agent) : 'System'}
          </div>
          {g.events.map((e) => (
            <Event key={e.id} e={e} />
          ))}
        </div>
      ))}
    </>
  );
}

function Event({ e }: { e: AgentTraceEvent }): JSX.Element {
  return (
    <div className={`event ${e.kind}`}>
      <span className="time">{fmtTime(e.at)}</span>
      <span className="body">
        <span className="kind">{e.kind.replace(/_/g, ' ')}</span>
        {e.tool && <>{humanize(e.tool)} </>}
        {e.message && <>· {e.message}</>}
      </span>
    </div>
  );
}
