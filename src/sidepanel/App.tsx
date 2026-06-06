import React, { useState } from 'react';
import { useExtensionBridge } from './state/bridge';
import { usePanelStore } from './state/store';
import { DailyBriefTab } from './tabs/DailyBriefTab';
import { ClutterTab } from './tabs/ClutterTab';
import { LedgerTab } from './tabs/LedgerTab';
import { ChatTab } from './tabs/ChatTab';
import { SettingsTab } from './tabs/SettingsTab';
import { AgentActivityPanel } from './cockpit/AgentActivityPanel';
import { send } from './state/bridge';

type TabId = 'brief' | 'clutter' | 'ledger' | 'chat' | 'settings';

export function App(): JSX.Element {
  useExtensionBridge();
  const [tab, setTab] = useState<TabId>('brief');
  const killSwitch = usePanelStore((s) => s.killSwitch);
  const dryRun = usePanelStore((s) => s.dryRun);
  const lastError = usePanelStore((s) => s.lastError);

  return (
    <div className="app">
      <header className="brand">
        <div>
          <h1>EmailSignal</h1>
          <div className="meta">
            {killSwitch ? (
              <span className="pill critical">KILL SWITCH</span>
            ) : dryRun ? (
              <span className="pill warn">DRY RUN</span>
            ) : (
              <span className="pill success">LIVE</span>
            )}
            {' '}<span className="subtle">multi-agent · human-in-the-loop</span>
          </div>
        </div>
        <button className="ghost" onClick={() => send({ kind: 'panel/request_scan' })}>
          ↻ Scan now
        </button>
      </header>

      <nav className="tabs" role="tablist">
        {[
          ['brief', 'Daily Brief'],
          ['clutter', 'Clutter'],
          ['ledger', 'Actions'],
          ['chat', 'Chat'],
          ['settings', 'Settings'],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id as TabId)}
            role="tab"
            aria-selected={tab === id}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="panel">
        {lastError && <div className="danger-banner">⚠ {lastError}</div>}
        {tab === 'brief' && <DailyBriefTab />}
        {tab === 'clutter' && <ClutterTab />}
        {tab === 'ledger' && <LedgerTab />}
        {tab === 'chat' && <ChatTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>

      <AgentActivityPanel />
    </div>
  );
}
