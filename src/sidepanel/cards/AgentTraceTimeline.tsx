import React from 'react';
import type { AgentTraceEvent } from '@schemas/index';

interface Props {
  events: AgentTraceEvent[];
  limit?: number;
}

export function AgentTraceTimeline({ events, limit = 80 }: Props): JSX.Element {
  const slice = events.slice(-limit).reverse();
  return (
    <div className="cockpit-events">
      {slice.length === 0 && <div className="empty">No agent activity yet.</div>}
      {slice.map((e) => (
        <div key={e.id} className={`event ${e.kind}`}>
          <span className="subtle">{new Date(e.at).toLocaleTimeString().slice(0, 8)}</span>
          <span className="kind">{e.kind}</span>
          <span>
            <span className="agent">{e.agent ?? '—'}</span>
            {e.message && <> · {e.message}</>}
            {e.tool && <> · <code>{e.tool}</code></>}
          </span>
        </div>
      ))}
    </div>
  );
}
