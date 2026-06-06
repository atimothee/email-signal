import React from 'react';
import type { AgentTraceEvent } from '@schemas/index';

interface Props {
  events: AgentTraceEvent[];
  limit?: number;
}

export function AgentTraceTimeline({ events, limit = 80 }: Props): JSX.Element {
  const slice = events.slice(-limit).reverse();
  if (slice.length === 0) {
    return <div className="faint" style={{ padding: '4px 0' }}>No activity yet.</div>;
  }
  return (
    <>
      {slice.map((e) => (
        <div key={e.id} className={`event ${e.kind}`}>
          <span className="time">{new Date(e.at).toLocaleTimeString().slice(0, 8)}</span>
          <span className="body">
            <span className="kind">{e.kind}</span>
            {e.agent && <>{e.agent}</>}
            {e.tool && <> · {e.tool}</>}
            {e.message && <> · {e.message}</>}
          </span>
        </div>
      ))}
    </>
  );
}
