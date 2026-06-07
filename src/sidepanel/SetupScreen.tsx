import React, { useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/common/constants';
import { isServerHealthy } from '@/common/server-client';

/**
 * First-run setup gate (issue #56).
 *
 * One scrollable screen that auto-detects the sidecar at `/health`, asks for the
 * single required input (OpenAI API key — unless `/health` says the server
 * already has one), and tucks the model override + Weave/observability config
 * behind disclosures. Persists to the same `STORAGE_KEYS` the Settings tab
 * already uses so onboarding and Settings stay in lockstep; the only new bit
 * of state is `STORAGE_KEYS.setupComplete`, which the parent gate uses to
 * skip this screen on subsequent loads.
 */

const DEFAULT_SERVER_URL = 'http://localhost:3030';
const OPENAI_KEYS_URL = 'https://platform.openai.com/api-keys';
const DEFAULT_WANDB_PROJECT = 'email-signal';

interface HealthInfo {
  hasOpenAIKey?: boolean;
  hasWeaveKey?: boolean;
  weaveProject?: string | null;
  version?: string;
}

type HealthState =
  | { kind: 'pending' }
  | { kind: 'ok'; info: HealthInfo }
  | { kind: 'down'; error: string };

interface SetupScreenProps {
  /** Fired once the user has cleared the gate; parent then renders the panel. */
  onComplete: () => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps): JSX.Element {
  const [hydrated, setHydrated] = useState(false);

  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [wandbApiKey, setWandbApiKey] = useState('');
  const [wandbProject, setWandbProject] = useState('');

  const [health, setHealth] = useState<HealthState>({ kind: 'pending' });
  const [showServerField, setShowServerField] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showObservability, setShowObservability] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Hydrate from chrome.storage.local before probing — so a returning user with
  // a custom URL doesn't waste a probe against the wrong host.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const v = await chrome.storage.local.get([
          STORAGE_KEYS.serverUrl,
          STORAGE_KEYS.apiKey,
          STORAGE_KEYS.model,
          STORAGE_KEYS.wandbApiKey,
          STORAGE_KEYS.wandbProject,
        ]);
        if (cancelled) return;
        const u = v[STORAGE_KEYS.serverUrl] as string | undefined;
        if (u?.trim()) setServerUrl(u.trim());
        const k = v[STORAGE_KEYS.apiKey] as string | undefined;
        if (k) setApiKey(k);
        const m = v[STORAGE_KEYS.model] as string | undefined;
        if (m) {
          setModel(m);
          setShowAdvanced(true);
        }
        const wk = v[STORAGE_KEYS.wandbApiKey] as string | undefined;
        if (wk) {
          setWandbApiKey(wk);
          setShowObservability(true);
        }
        const wp = v[STORAGE_KEYS.wandbProject] as string | undefined;
        if (wp) setWandbProject(wp);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const probeHealth = async (rawUrl: string) => {
    setHealth({ kind: 'pending' });
    const cleaned = rawUrl.trim().replace(/\/$/, '') || DEFAULT_SERVER_URL;
    const r = await isServerHealthy(cleaned);
    if (r.ok) {
      setHealth({ kind: 'ok', info: (r.info as HealthInfo | undefined) ?? {} });
    } else {
      setHealth({ kind: 'down', error: r.error ?? 'unreachable' });
      // Reveal the URL field on failure so the user can fix it without hunting.
      setShowServerField(true);
    }
  };

  // Auto-probe once hydration completes, and re-probe when the URL field changes
  // (debounced via blur in the input handler — see SidecarStatus).
  useEffect(() => {
    if (!hydrated) return;
    void probeHealth(serverUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const serverHasKey = health.kind === 'ok' && !!health.info.hasOpenAIKey;
  const haveKey = serverHasKey || apiKey.trim().length > 0;
  const sidecarReachable = health.kind === 'ok';
  const canSubmit = !submitting && sidecarReachable && haveKey;

  const persistAndComplete = async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      // Non-extension preview build — just call onComplete so devs can see Today.
      onComplete();
      return;
    }
    const cleanedUrl = (serverUrl.trim() || DEFAULT_SERVER_URL).replace(/\/$/, '');
    const payload: Record<string, string | boolean> = {
      [STORAGE_KEYS.serverUrl]: cleanedUrl,
    };
    if (apiKey.trim()) payload[STORAGE_KEYS.apiKey] = apiKey.trim();
    if (model.trim()) payload[STORAGE_KEYS.model] = model.trim();
    if (wandbApiKey.trim()) {
      payload[STORAGE_KEYS.wandbApiKey] = wandbApiKey.trim();
      // Default the project only when a key was entered (issue #56 spec).
      payload[STORAGE_KEYS.wandbProject] = wandbProject.trim() || DEFAULT_WANDB_PROJECT;
    } else if (wandbProject.trim()) {
      payload[STORAGE_KEYS.wandbProject] = wandbProject.trim();
    }
    payload[STORAGE_KEYS.setupComplete] = true;
    await chrome.storage.local.set(payload);
    onComplete();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Re-probe /health as final validation: catches "user pasted a key but
      // also typo'd the URL into something unreachable" before we declare
      // setup complete.
      const cleanedUrl = (serverUrl.trim() || DEFAULT_SERVER_URL).replace(/\/$/, '');
      const r = await isServerHealthy(cleanedUrl);
      if (!r.ok) {
        setHealth({ kind: 'down', error: r.error ?? 'unreachable' });
        setShowServerField(true);
        setSubmitError(
          `Can't reach the sidecar at ${cleanedUrl}: ${r.error ?? 'unreachable'}.`
        );
        return;
      }
      const info = (r.info as HealthInfo | undefined) ?? {};
      setHealth({ kind: 'ok', info });
      const stillHaveKey = !!info.hasOpenAIKey || apiKey.trim().length > 0;
      if (!stillHaveKey) {
        setSubmitError('OpenAI key is required.');
        return;
      }
      await persistAndComplete();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hydrated) {
    // No-flash gate: render nothing meaningful until storage hydrates so a
    // returning user never sees a blink of this screen.
    return <div className="setup-shell" aria-hidden />;
  }

  return (
    <div className="setup-shell">
      <div className="setup-card">
        <h1 className="setup-title">Welcome to Email Signal</h1>
        <p className="setup-sub">
          Email Signal needs an OpenAI key to read and triage your inbox. This takes about a minute.
        </p>

        <SidecarStatus
          state={health}
          url={serverUrl}
          showField={showServerField}
          onToggleField={() => setShowServerField((v) => !v)}
          onUrlChange={setServerUrl}
          onCommitUrl={() => void probeHealth(serverUrl)}
          onRecheck={() => void probeHealth(serverUrl)}
        />

        <section className="setup-section">
          <div className="setup-section-head">
            <div className="setup-section-title">OpenAI API key</div>
            {!serverHasKey && <span className="pill warn">Required</span>}
            {serverHasKey && <span className="pill success">detected on server</span>}
          </div>
          {serverHasKey ? (
            <div className="hint">
              Your sidecar's <code>server/.env</code> already provides{' '}
              <code>OPENAI_API_KEY</code>, so no key is needed here. You can still paste one
              below to override it.
            </div>
          ) : (
            <div className="hint">
              Sent to your sidecar; never called directly from the browser. Stored only in
              this browser profile.{' '}
              <a href={OPENAI_KEYS_URL} target="_blank" rel="noreferrer">
                Get a key →
              </a>
            </div>
          )}
          <input
            className="input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ marginTop: 6 }}
            placeholder={serverHasKey ? 'Optional — overrides server key' : 'sk-…'}
            autoComplete="off"
            spellCheck={false}
            autoFocus={!serverHasKey}
          />
        </section>

        <Disclosure
          label="Advanced"
          open={showAdvanced}
          onToggle={() => setShowAdvanced((v) => !v)}
        >
          <div className="setup-section-title" style={{ marginBottom: 2 }}>
            Model
          </div>
          <div className="hint">
            Chat model the sidecar uses. Leave blank to use the server default (
            <code>gpt-4.1-mini</code>).
          </div>
          <input
            className="input"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{ marginTop: 6 }}
            placeholder="gpt-4.1-mini"
            autoComplete="off"
            spellCheck={false}
          />
        </Disclosure>

        <Disclosure
          label="Observability (optional)"
          open={showObservability}
          onToggle={() => setShowObservability((v) => !v)}
        >
          <div className="hint" style={{ marginBottom: 8 }}>
            Optional — enables tracing/observability with W&amp;B Weave. Safe to skip.
          </div>
          <div className="setup-section-title" style={{ marginBottom: 2 }}>
            Weave API key
          </div>
          <input
            className="input"
            type="password"
            value={wandbApiKey}
            onChange={(e) => setWandbApiKey(e.target.value)}
            style={{ marginTop: 6 }}
            placeholder="W&B key"
            autoComplete="off"
            spellCheck={false}
          />
          <div
            className="setup-section-title"
            style={{ marginTop: 10, marginBottom: 2 }}
          >
            Weave project
          </div>
          <input
            className="input"
            type="text"
            value={wandbProject}
            onChange={(e) => setWandbProject(e.target.value)}
            style={{ marginTop: 6 }}
            placeholder={DEFAULT_WANDB_PROJECT}
            autoComplete="off"
            spellCheck={false}
          />
        </Disclosure>

        {submitError && (
          <div className="danger-banner" style={{ marginTop: 12 }}>
            {submitError}
          </div>
        )}

        <div className="setup-cta">
          <button
            className="primary setup-primary"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {submitting ? 'Checking…' : 'Start using Email Signal'}
          </button>
          {!submitting && !canSubmit && (
            <div className="subtle setup-cta-hint">
              {!sidecarReachable
                ? 'Waiting for the sidecar to be reachable…'
                : !haveKey
                  ? 'Paste an OpenAI key to continue.'
                  : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SidecarStatusProps {
  state: HealthState;
  url: string;
  showField: boolean;
  onToggleField: () => void;
  onUrlChange: (next: string) => void;
  onCommitUrl: () => void;
  onRecheck: () => void;
}

function SidecarStatus({
  state,
  url,
  showField,
  onToggleField,
  onUrlChange,
  onCommitUrl,
  onRecheck,
}: SidecarStatusProps): JSX.Element {
  const chip = (() => {
    switch (state.kind) {
      case 'pending':
        return <span className="pill warn">checking…</span>;
      case 'ok':
        return <span className="pill success">✓ Connected to the sidecar</span>;
      case 'down':
        return <span className="pill critical">✗ Can't reach the sidecar</span>;
    }
  })();

  const meta = (() => {
    if (state.kind === 'ok') {
      const v = state.info.version ? `v${state.info.version}` : null;
      const k = state.info.hasOpenAIKey ? 'OpenAI key on server' : null;
      const w = state.info.hasWeaveKey
        ? `Weave: ${state.info.weaveProject ?? 'on'}`
        : null;
      const parts = [v, k, w].filter(Boolean) as string[];
      if (!parts.length) return null;
      return <div className="setup-status-meta">{parts.join(' · ')}</div>;
    }
    if (state.kind === 'down') {
      return (
        <div className="setup-status-error">
          {state.error}. Start the sidecar with <code>npm run server</code> in the Email
          Signal repo, then click Recheck.
        </div>
      );
    }
    return null;
  })();

  return (
    <section className="setup-section setup-status">
      <div className="setup-status-row">
        {chip}
        <button className="ghost setup-recheck" onClick={onRecheck} type="button">
          Recheck
        </button>
      </div>
      {meta}
      {!showField && state.kind !== 'down' && (
        <button
          className="setup-link"
          onClick={onToggleField}
          type="button"
          aria-expanded={showField}
        >
          Change address
        </button>
      )}
      {(showField || state.kind === 'down') && (
        <>
          <div className="setup-section-title" style={{ marginTop: 8 }}>
            Sidecar URL
          </div>
          <input
            className="input"
            type="text"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onBlur={onCommitUrl}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommitUrl();
              }
            }}
            style={{ marginTop: 6 }}
            placeholder={DEFAULT_SERVER_URL}
            spellCheck={false}
            autoComplete="off"
          />
        </>
      )}
    </section>
  );
}

interface DisclosureProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Disclosure({ label, open, onToggle, children }: DisclosureProps): JSX.Element {
  return (
    <section className={`setup-disclosure ${open ? 'open' : ''}`}>
      <button
        className="setup-disclosure-trigger"
        onClick={onToggle}
        type="button"
        aria-expanded={open}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="setup-disclosure-chev"
          aria-hidden
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
        {label}
      </button>
      {open && <div className="setup-disclosure-body">{children}</div>}
    </section>
  );
}
