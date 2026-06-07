import React, { useEffect, useState } from 'react';
import { usePanelStore } from '../state/store';
import { send } from '../state/bridge';
import { STORAGE_KEYS } from '@/common/constants';
import { nanoid } from 'nanoid';

interface ServerStatus {
  state: 'idle' | 'checking' | 'ok' | 'down';
  info?: {
    hasOpenAIKey: boolean;
    hasWeaveKey: boolean;
    weaveProject: string | null;
    version: string;
  };
  error?: string;
}

const DEFAULT_BASE = 'http://localhost:3030';

export function SettingsTab(): JSX.Element {
  const dryRun = usePanelStore((s) => s.dryRun);
  const setDryRun = usePanelStore((s) => s.setDryRun);
  const killSwitch = usePanelStore((s) => s.killSwitch);
  const setKillSwitch = usePanelStore((s) => s.setKillSwitch);

  const [importantSender, setImportantSender] = useState('');
  const [ignoreSender, setIgnoreSender] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_BASE);
  const [serverStatus, setServerStatus] = useState<ServerStatus>({ state: 'idle' });
  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);

  // Load saved server URL + OpenAI key once.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    void chrome.storage.local
      .get([STORAGE_KEYS.serverUrl, STORAGE_KEYS.apiKey])
      .then((v) => {
        const stored = v[STORAGE_KEYS.serverUrl] as string | undefined;
        if (stored?.trim()) setServerUrl(stored.trim());
        const key = v[STORAGE_KEYS.apiKey] as string | undefined;
        if (key) setApiKey(key);
      });
  }, []);

  const saveApiKey = async (next: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [STORAGE_KEYS.apiKey]: next.trim() });
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 1500);
  };

  const saveServerUrl = async (next: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [STORAGE_KEYS.serverUrl]: next });
  };

  const checkServer = async () => {
    setServerStatus({ state: 'checking' });
    try {
      const url = serverUrl.trim().replace(/\/$/, '');
      const res = await fetch(`${url}/health`, { method: 'GET' });
      if (!res.ok) {
        setServerStatus({ state: 'down', error: `${res.status} ${res.statusText}` });
        return;
      }
      const info = await res.json();
      setServerStatus({ state: 'ok', info });
    } catch (err) {
      setServerStatus({ state: 'down', error: (err as Error).message });
    }
  };

  // Auto-check once on mount.
  useEffect(() => {
    void checkServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePref = (kind: 'important_sender' | 'ignored_sender', value: string) => {
    if (!value.trim()) return;
    send({
      kind: 'panel/save_preference',
      preference: {
        id: nanoid(),
        kind,
        key: value.trim().toLowerCase(),
        value: value.trim(),
        source: 'user_settings',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const statusPill = (() => {
    switch (serverStatus.state) {
      case 'checking':
        return <span className="pill warn">checking…</span>;
      case 'ok':
        return <span className="pill success">connected</span>;
      case 'down':
        return <span className="pill critical">unreachable</span>;
      default:
        return <span className="pill">idle</span>;
    }
  })();

  return (
    <div>
      {killSwitch && (
        <div className="danger-banner">
          Kill switch is ON. No agent actions will run. Toggle below to resume.
        </div>
      )}

      <div className="settings-row">
        <div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="label">Email Signal sidecar (required)</div>
            {statusPill}
          </div>
          <div className="hint">
            All intelligence runs in a local Node sidecar (OpenAI Agents SDK + W&amp;B
            Weave + Redis memory). Start it with <code>npm run server</code>. The
            extension does no AI itself — if the sidecar is unreachable, scanning will
            show an error.
          </div>
          <input
            className="input"
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            onBlur={() => saveServerUrl(serverUrl.trim())}
            style={{ marginTop: 6 }}
            placeholder={DEFAULT_BASE}
          />
          {serverStatus.state === 'ok' && serverStatus.info && (
            <div className="subtle" style={{ marginTop: 6 }}>
              v{serverStatus.info.version} · OpenAI key{' '}
              {serverStatus.info.hasOpenAIKey ? (
                <span className="pill success">set</span>
              ) : (
                <span className="pill critical">missing</span>
              )}{' '}
              · Weave{' '}
              {serverStatus.info.hasWeaveKey ? (
                <span className="pill success">{serverStatus.info.weaveProject ?? 'on'}</span>
              ) : (
                <span className="pill">off</span>
              )}
            </div>
          )}
          {serverStatus.state === 'down' && (
            <div className="subtle" style={{ color: 'var(--danger)', marginTop: 6 }}>
              {serverStatus.error}. Run <code>npm run server</code> in the Email Signal repo,
              then click Recheck.
            </div>
          )}
        </div>
        <button onClick={checkServer}>Recheck</button>
      </div>

      <div className="settings-row">
        <div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="label">OpenAI API key</div>
            {apiKey && <span className="pill success">{keySaved ? 'saved' : 'set'}</span>}
          </div>
          <div className="hint">
            Sent to your sidecar, which uses it with the OpenAI Agents SDK — never used for
            direct calls from the browser. Stored only in this browser. Leave blank to use
            the key in <code>server/.env</code> instead.
          </div>
          <input
            className="input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => saveApiKey(apiKey)}
            style={{ marginTop: 6 }}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button onClick={() => saveApiKey(apiKey)} className={apiKey ? 'success' : undefined}>
          Save
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="label">Dry run</div>
          <div className="hint">
            When ON, approved actions are logged to the ledger but no DOM clicks happen.
            Recommended while you trust-build.
          </div>
        </div>
        <button
          className={dryRun ? 'success' : 'ghost'}
          onClick={() => {
            const next = !dryRun;
            setDryRun(next);
            send({ kind: 'panel/set_dry_run', enabled: next });
          }}
        >
          {dryRun ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="label">Kill switch</div>
          <div className="hint">
            Immediately stops every agent and blocks all proposed actions. Use this if
            anything looks wrong.
          </div>
        </div>
        <button
          className={killSwitch ? 'danger' : 'ghost'}
          onClick={() => {
            const next = !killSwitch;
            setKillSwitch(next);
            send({ kind: 'panel/kill_switch', enabled: next });
          }}
        >
          {killSwitch ? 'ENABLED' : 'OFF'}
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="label">Important senders</div>
          <div className="hint">Domains or addresses we should never suggest unsubscribing from.</div>
          <input
            className="input"
            placeholder="e.g. boss@acme.com or @bank.com"
            value={importantSender}
            onChange={(e) => setImportantSender(e.target.value)}
            style={{ marginTop: 6 }}
          />
        </div>
        <button
          onClick={() => {
            savePref('important_sender', importantSender);
            setImportantSender('');
          }}
        >
          Add
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="label">Ignored senders</div>
          <div className="hint">Senders we should not surface in the daily brief.</div>
          <input
            className="input"
            placeholder="e.g. spam@example.com"
            value={ignoreSender}
            onChange={(e) => setIgnoreSender(e.target.value)}
            style={{ marginTop: 6 }}
          />
        </div>
        <button
          onClick={() => {
            savePref('ignored_sender', ignoreSender);
            setIgnoreSender('');
          }}
        >
          Add
        </button>
      </div>

      <div className="subtle" style={{ marginTop: 14 }}>
        Email Signal V1 is read-mostly. We never delete or send mail. Approval cards always
        precede DOM clicks. See README.md → Safety model.
      </div>
    </div>
  );
}
