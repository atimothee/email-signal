import React, { useEffect, useState } from 'react';
import { usePanelStore } from '../state/store';
import { send } from '../state/bridge';
import { STORAGE_KEYS } from '@/common/constants';
import { nanoid } from 'nanoid';
import { ActionLedgerTable } from '../cards/ActionLedgerTable';

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
  const ledger = usePanelStore((s) => s.ledger);

  const [importantSender, setImportantSender] = useState('');
  const [ignoreSender, setIgnoreSender] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_BASE);
  const [serverStatus, setServerStatus] = useState<ServerStatus>({ state: 'idle' });
  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [model, setModel] = useState('');
  const [modelSaved, setModelSaved] = useState(false);
  const [wandbApiKey, setWandbApiKey] = useState('');
  const [wandbKeySaved, setWandbKeySaved] = useState(false);
  const [wandbProject, setWandbProject] = useState('');
  const [wandbProjectSaved, setWandbProjectSaved] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [notifyDecisions, setNotifyDecisions] = useState(true);
  const [notifyClutter, setNotifyClutter] = useState(true);

  // Load saved server URL + Settings-first config once.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    void chrome.storage.local
      .get([
        STORAGE_KEYS.serverUrl,
        STORAGE_KEYS.apiKey,
        STORAGE_KEYS.model,
        STORAGE_KEYS.wandbApiKey,
        STORAGE_KEYS.wandbProject,
        STORAGE_KEYS.notifyEnabled,
        STORAGE_KEYS.notifyDecisions,
        STORAGE_KEYS.notifyClutter,
      ])
      .then((v) => {
        const stored = v[STORAGE_KEYS.serverUrl] as string | undefined;
        if (stored?.trim()) setServerUrl(stored.trim());
        const key = v[STORAGE_KEYS.apiKey] as string | undefined;
        if (key) setApiKey(key);
        const m = v[STORAGE_KEYS.model] as string | undefined;
        if (m) setModel(m);
        const wk = v[STORAGE_KEYS.wandbApiKey] as string | undefined;
        if (wk) setWandbApiKey(wk);
        const wp = v[STORAGE_KEYS.wandbProject] as string | undefined;
        if (wp) setWandbProject(wp);
        setNotifyEnabled(v[STORAGE_KEYS.notifyEnabled] === true);
        // Per-category toggles default ON (only honored when the master is on).
        setNotifyDecisions(v[STORAGE_KEYS.notifyDecisions] !== false);
        setNotifyClutter(v[STORAGE_KEYS.notifyClutter] !== false);
      });
  }, []);

  const toggleNotify = async () => {
    const next = !notifyEnabled;
    setNotifyEnabled(next);
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [STORAGE_KEYS.notifyEnabled]: next });
  };

  const toggleNotifyCategory = async (
    key: typeof STORAGE_KEYS.notifyDecisions | typeof STORAGE_KEYS.notifyClutter,
    current: boolean,
    setter: (v: boolean) => void
  ) => {
    const next = !current;
    setter(next);
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [key]: next });
  };

  const saveApiKey = async (next: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [STORAGE_KEYS.apiKey]: next.trim() });
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 1500);
  };

  const saveModel = async (next: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [STORAGE_KEYS.model]: next.trim() });
    setModelSaved(true);
    setTimeout(() => setModelSaved(false), 1500);
  };

  const saveWandbApiKey = async (next: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [STORAGE_KEYS.wandbApiKey]: next.trim() });
    setWandbKeySaved(true);
    setTimeout(() => setWandbKeySaved(false), 1500);
  };

  const saveWandbProject = async (next: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [STORAGE_KEYS.wandbProject]: next.trim() });
    setWandbProjectSaved(true);
    setTimeout(() => setWandbProjectSaved(false), 1500);
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
            direct calls from the browser. Stored only in this browser. This setting takes
            precedence; leave blank to fall back to <code>OPENAI_API_KEY</code> in{' '}
            <code>server/.env</code>.
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
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="label">Model</div>
            {model && <span className="pill success">{modelSaved ? 'saved' : 'set'}</span>}
          </div>
          <div className="hint">
            Chat model the sidecar uses. Leave blank to use <code>EMAIL_SIGNAL_MODEL</code> in{' '}
            <code>server/.env</code> (default <code>gpt-4.1-mini</code>).
          </div>
          <input
            className="input"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => saveModel(model)}
            style={{ marginTop: 6 }}
            placeholder="gpt-4.1-mini"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button onClick={() => saveModel(model)} className={model ? 'success' : undefined}>
          Save
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="label">Weave API key</div>
            {wandbApiKey && (
              <span className="pill success">{wandbKeySaved ? 'saved' : 'set'}</span>
            )}
          </div>
          <div className="hint">
            W&amp;B Weave observability key, forwarded to your sidecar. Leave blank to use{' '}
            <code>WANDB_API_KEY</code> in <code>server/.env</code>. Changing the Weave project
            takes effect after a server restart.
          </div>
          <input
            className="input"
            type="password"
            value={wandbApiKey}
            onChange={(e) => setWandbApiKey(e.target.value)}
            onBlur={() => saveWandbApiKey(wandbApiKey)}
            style={{ marginTop: 6 }}
            placeholder="W&B key"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button
          onClick={() => saveWandbApiKey(wandbApiKey)}
          className={wandbApiKey ? 'success' : undefined}
        >
          Save
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="label">Weave project</div>
            {wandbProject && (
              <span className="pill success">{wandbProjectSaved ? 'saved' : 'set'}</span>
            )}
          </div>
          <div className="hint">
            W&amp;B project for traces. Leave blank to use <code>WANDB_PROJECT</code> in{' '}
            <code>server/.env</code> (default <code>email-signal</code>).
          </div>
          <input
            className="input"
            type="text"
            value={wandbProject}
            onChange={(e) => setWandbProject(e.target.value)}
            onBlur={() => saveWandbProject(wandbProject)}
            style={{ marginTop: 6 }}
            placeholder="email-signal"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button
          onClick={() => saveWandbProject(wandbProject)}
          className={wandbProject ? 'success' : undefined}
        >
          Save
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="label">Dry run</div>
          <div className="hint">
            When ON, state-changing actions (mark read, archive, unsubscribe, label) are logged
            but not executed. Opening or revealing an email in Gmail still works. Recommended
            while you trust-build.
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
          <div className="label">Notifications</div>
          <div className="hint">
            When ON, a finished scan can nudge you with a Chrome notification — when
            something high-priority needs you, or a batch of senders is ready to clean up.
            Clicking it opens the side panel. Off by default; the kill switch silences these too.
          </div>
        </div>
        <button className={notifyEnabled ? 'success' : 'ghost'} onClick={toggleNotify}>
          {notifyEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {notifyEnabled && (
        <>
          <div className="settings-row" style={{ paddingLeft: 16 }}>
            <div>
              <div className="label">— Needs-you / daily brief</div>
              <div className="hint">
                When something high-priority surfaces. Doubles as your “daily brief ready”
                nudge and fires at most once a day.
              </div>
            </div>
            <button
              className={notifyDecisions ? 'success' : 'ghost'}
              onClick={() =>
                toggleNotifyCategory(STORAGE_KEYS.notifyDecisions, notifyDecisions, setNotifyDecisions)
              }
            >
              {notifyDecisions ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="settings-row" style={{ paddingLeft: 16 }}>
            <div>
              <div className="label">— Unsubscribe batch ready</div>
              <div className="hint">
                When several senders are queued and ready to clean up in a few clicks.
              </div>
            </div>
            <button
              className={notifyClutter ? 'success' : 'ghost'}
              onClick={() =>
                toggleNotifyCategory(STORAGE_KEYS.notifyClutter, notifyClutter, setNotifyClutter)
              }
            >
              {notifyClutter ? 'ON' : 'OFF'}
            </button>
          </div>
        </>
      )}

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

      <div style={{ marginTop: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="label">Activity log</div>
          <span className="pill">{ledger.length}</span>
        </div>
        <div className="hint">
          Every action the agent proposes, runs, is blocked from, or you reject — newest first.
          This is the full audit trail; nothing the agent does happens off the record.
        </div>
        <div style={{ marginTop: 8 }}>
          {ledger.length === 0 ? (
            <div className="subtle">No activity yet. Approve an action and it'll appear here.</div>
          ) : (
            <ActionLedgerTable entries={ledger.slice(-50)} />
          )}
        </div>
      </div>

      <div className="subtle" style={{ marginTop: 14 }}>
        Email Signal V1 is read-mostly. We never delete or send mail. Approval cards always
        precede DOM clicks. See README.md → Safety model.
      </div>
    </div>
  );
}
