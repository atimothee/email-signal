import React, { useState } from 'react';
import { usePanelStore } from '../state/store';
import { AgentTraceTimeline } from '../cards/AgentTraceTimeline';

export function AgentActivityPanel(): JSX.Element {
  const events = usePanelStore((s) => s.traceEvents);
  const [open, setOpen] = useState(true);
  const latest = events[events.length - 1];
  return (
    <section className="cockpit" style={{ maxHeight: open ? 220 : 36 }}>
      <header className="cockpit-header">
        <div className="row" style={{ gap: 8 }}>
          <strong style={{ fontSize: 12 }}>Agent activity</strong>
          {latest && (
            <span className="subtle">
              · {latest.kind} {latest.agent ? `(${latest.agent})` : ''}
            </span>
          )}
        </div>
        <button className="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? '▼' : '▲'}
        </button>
      </header>
      {open && <AgentTraceTimeline events={events} />}
    </section>
  );
}
