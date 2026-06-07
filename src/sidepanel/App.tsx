import React, { useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/common/constants';
import { isServerHealthy } from '@/common/server-client';
import { useExtensionBridge, send } from './state/bridge';
import { usePanelStore } from './state/store';
import { DailyBriefTab } from './tabs/DailyBriefTab';
import { ClutterTab } from './tabs/ClutterTab';
import { LedgerTab } from './tabs/LedgerTab';
import { ChatTab } from './tabs/ChatTab';
import { SettingsTab } from './tabs/SettingsTab';
import { AgentActivityPanel } from './cockpit/AgentActivityPanel';
import { AccountIndicator } from './AccountIndicator';
import { SetupScreen } from './SetupScreen';

type TabId = 'today' | 'cleanup' | 'chat';
type Overlay = null | 'history' | 'settings';
type GateState = 'pending' | 'setup' | 'ready';

const TABS: ReadonlyArray<[TabId, string]> = [
  ['today', 'Today'],
  ['cleanup', 'Cleanup'],
  ['chat', 'Chat'],
];

/**
 * App is the first-run setup gate (issue #56). It decides between the setup
 * screen and the panel before any panel UI mounts, so a configured user never
 * sees the setup screen flash. The actual panel body lives in `<Panel />`.
 *
 * Decision rules:
 *   1. `STORAGE_KEYS.setupComplete === true` → render Panel immediately.
 *   2. Otherwise probe `/health` + read the extension's OpenAI key. If the
 *      sidecar is reachable AND a key is present (extension or server-side),
 *      promote the user silently — sets `setupComplete` so future loads stay
 *      instant, and renders Panel. This covers users who configured before
 *      this gate existed.
 *   3. Otherwise → render the SetupScreen.
 */
export function App(): JSX.Element {
  const [gateState, setGateState] = useState<GateState>('pending');

  useEffect(() => {
    let cancelled = false;

    const evaluate = async () => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        // Dev preview build (e.g. `build:sidepanel`) — there's no chrome.storage
        // and no sidecar gate to enforce, so just render the panel.
        if (!cancelled) setGateState('ready');
        return;
      }
      const v = await chrome.storage.local.get([
        STORAGE_KEYS.setupComplete,
        STORAGE_KEYS.apiKey,
      ]);
      if (cancelled) return;
      if (v[STORAGE_KEYS.setupComplete] === true) {
        setGateState('ready');
        return;
      }
      // Legacy fast-path: a returning user has the required config but no
      // flag yet. Promote silently rather than asking them to re-onboard.
      const extKey = (v[STORAGE_KEYS.apiKey] as string | undefined)?.trim() ?? '';
      const probe = await isServerHealthy();
      if (cancelled) return;
      const serverHasKey = !!probe.info?.hasOpenAIKey;
      if (probe.ok && (extKey || serverHasKey)) {
        await chrome.storage.local.set({ [STORAGE_KEYS.setupComplete]: true });
        if (!cancelled) setGateState('ready');
        return;
      }
      if (!cancelled) setGateState('setup');
    };

    void evaluate();

    // Re-evaluate when setupComplete flips (e.g. user clicks "Re-run setup"
    // in Settings, which clears the flag).
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
      return () => {
        cancelled = true;
      };
    }
    const onChanged = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return;
      if (changes[STORAGE_KEYS.setupComplete]) void evaluate();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  if (gateState === 'pending') {
    // No-flash neutral placeholder — the visual weight matches `.setup-shell`
    // so first paint never jolts the layout when the decision resolves.
    return <div className="setup-shell" aria-hidden />;
  }
  if (gateState === 'setup') {
    return <SetupScreen onComplete={() => setGateState('ready')} />;
  }
  return <Panel />;
}

function Panel(): JSX.Element {
  useExtensionBridge();
  const [tab, setTab] = useState<TabId>('today');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const killSwitch = usePanelStore((s) => s.killSwitch);
  const dryRun = usePanelStore((s) => s.dryRun);
  const lastError = usePanelStore((s) => s.lastError);
  const scanStatus = usePanelStore((s) => s.scanStatus);

  // Honest spinner: spins only while real work is happening (issue #7 fix).
  const scanning = scanStatus === 'reading' || scanStatus === 'thinking';

  const statusTone = killSwitch ? 'critical' : dryRun ? 'warn' : '';
  const statusLabel = killSwitch ? 'Kill switch' : dryRun ? 'Dry run' : 'Live';

  const handleScan = () => {
    if (scanning) return;
    send({ kind: 'panel/request_scan' });
  };

  useEffect(() => {
    if (overlay === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);

  return (
    <div className="app">
      <header className="brand">
        <div className="brand-left">
          <h1 className="wordmark">Email Signal</h1>
          <span className={`status-chip ${statusTone}`}>
            <span className="dot" />
            {statusLabel}
          </span>
        </div>
        <div className="brand-actions">
          <IconButton
            label={scanning ? 'Scanning…' : 'Scan now'}
            spinning={scanning}
            onClick={handleScan}
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
                <path d="M13.5 2.5v3h-3" />
              </svg>
            }
          />
          <IconButton
            label="History"
            active={overlay === 'history'}
            onClick={() => setOverlay(overlay === 'history' ? null : 'history')}
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 4v4l2.5 1.5" />
                <circle cx="8" cy="8" r="6" />
              </svg>
            }
          />
          <IconButton
            label="Settings"
            active={overlay === 'settings'}
            onClick={() => setOverlay(overlay === 'settings' ? null : 'settings')}
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="2" />
                <path d="M13 8c0 .4 0 .8-.1 1.2l1.4 1.1-1.4 2.4-1.7-.6c-.6.5-1.3.9-2 1.1L9 15H7l-.2-1.8a5 5 0 0 1-2-1.1l-1.7.6-1.4-2.4 1.4-1.1a5 5 0 0 1 0-2.4L1.7 5.7l1.4-2.4 1.7.6a5 5 0 0 1 2-1.1L7 1h2l.2 1.8c.7.2 1.4.6 2 1.1l1.7-.6 1.4 2.4-1.4 1.1c.1.4.1.8.1 1.2Z" />
              </svg>
            }
          />
        </div>
      </header>

      <AccountIndicator />

      <AgentActivityPanel />

      {overlay === null && (
        <nav className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
              role="tab"
              aria-selected={tab === id}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      <main className="panel">
        {lastError && <div className="danger-banner">{lastError}</div>}
        {overlay === 'history' ? (
          <OverlayWrapper title="Action history" onClose={() => setOverlay(null)}>
            <LedgerTab />
          </OverlayWrapper>
        ) : overlay === 'settings' ? (
          <OverlayWrapper title="Settings" onClose={() => setOverlay(null)}>
            <SettingsTab />
          </OverlayWrapper>
        ) : (
          <>
            {tab === 'today' && <DailyBriefTab />}
            {tab === 'cleanup' && <ClutterTab />}
            {tab === 'chat' && <ChatTab />}
          </>
        )}
      </main>
    </div>
  );
}

interface IconButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  spinning?: boolean;
  onClick: () => void;
}

function IconButton({ icon, label, active, spinning, onClick }: IconButtonProps): JSX.Element {
  return (
    <button
      className={`icon ${active ? 'active' : ''} ${spinning ? 'spinning' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

interface OverlayWrapperProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function OverlayWrapper({ title, onClose, children }: OverlayWrapperProps): JSX.Element {
  return (
    <div>
      <div className="overlay-header">
        <button className="overlay-back" onClick={onClose} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3 5 8l5 5" />
          </svg>
          {title}
        </button>
        <span className="overlay-hint">
          <kbd>Esc</kbd> to close
        </span>
      </div>
      {children}
    </div>
  );
}
