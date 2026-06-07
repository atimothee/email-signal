/** Front-facing product name (issue #12). Internal log prefixes stay [EmailSignal]. */
export const APP_NAME = 'Email Signal';
export const STORAGE_KEYS = {
  // NOTE: user preferences live in the memory store (es.mem.prefs, keyed by
  // userId) — see src/memory/json-store.ts. The old flat 'es.preferences.v1'
  // key was retired because the scan never read it (muting was a no-op).
  ledger: 'es.ledger.v1',
  killSwitch: 'es.killSwitch.v1',
  dryRun: 'es.dryRun.v1',
  apiKey: 'es.openai.apiKey.v1',
  model: 'es.openai.model.v1',
  wandbApiKey: 'es.wandb.apiKey.v1',
  wandbProject: 'es.wandb.project.v1',
  memorySuggestions: 'es.memorySuggestions.v1',
  traceEvents: 'es.trace.v1',
  serverUrl: 'es.server.url.v1',
  account: 'es.account.v1',
  /** Opt-in master switch: fire Chrome notifications when a scan surfaces something. Default off. */
  notifyEnabled: 'es.notify.enabled.v1',
  /**
   * Per-category opt-out (both default ON when the master switch is on):
   *  - notifyDecisions: high-priority "needs you today" / daily-brief nudge
   *  - notifyClutter:   "unsubscribe batch ready" nudge
   */
  notifyDecisions: 'es.notify.decisions.v1',
  notifyClutter: 'es.notify.clutter.v1',
  /** Dedup state so identical results don't re-notify (last signatures + brief date). */
  notifyState: 'es.notify.state.v1',
  /**
   * Weave call id of the most recent scan (issue #46). The decisions on screen
   * always come from the latest scan, so disposition/mute feedback attaches to
   * this call. Set when a scan returns a `weaveCallId`; absent when Weave is off.
   */
  scanTrace: 'es.scan.trace.v1',
  /**
   * First-run setup completion flag (issue #56). Set to `true` once the user
   * has cleared the onboarding gate with a working OpenAI key + reachable
   * sidecar. Versioned so we can re-trigger setup if the required surface
   * changes. Cleared by the Settings "Re-run setup" link without wiping the
   * underlying keys.
   */
  setupComplete: 'es.setup.complete.v1',
} as const;

export const DEFAULTS = {
  dryRun: true,
  killSwitch: false,
  notifyIntervalMin: 30,
  /** Min senders queued before an "unsubscribe batch ready" notification fires. */
  notifyUnsubBatchMin: 5,
  maxCandidatesPerScan: 100,
  bodyExcerptChars: 512,
  approvalExpiryMs: 1000 * 60 * 30, // 30 minutes
  /** How many recent emails to deep-scan before sending to the sidecar. */
  deepScanTarget: 500,
  /**
   * Background-tab paginated scan (Option B). Gmail's web UI paginates ~50 rows
   * per page, so to reach `deepScanTarget` we click "Older" page by page inside
   * an unfocused Gmail tab. These bound that loop and keep it human-paced so it
   * doesn't trip Gmail's "unusual activity" rate limiting.
   */
  /** Hard cap on page navigations per scan (×~50 rows). 12 → up to ~600. */
  deepScanMaxPages: 12,
  /** Max wait for a page to render after navigating. Generous because hidden
   *  background tabs are timer-throttled by Chrome, so renders run slower. */
  pageSettleTimeoutMs: 12000,
  /** Human-like delay between page navigations (anti-rate-limit pacing). */
  interPageDelayMs: 700,
  /** Max wait for the background Gmail tab to finish loading before scanning. */
  bgTabReadyTimeoutMs: 25000,
  /** Max wait for inbox rows to appear before concluding the page is empty. */
  rowsAppearTimeoutMs: 10000,
} as const;

export const ALARMS = {
  periodicScan: 'es.periodicScan',
} as const;
