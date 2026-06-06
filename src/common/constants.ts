export const APP_NAME = 'EmailSignal';
export const STORAGE_KEYS = {
  preferences: 'es.preferences.v1',
  ledger: 'es.ledger.v1',
  killSwitch: 'es.killSwitch.v1',
  dryRun: 'es.dryRun.v1',
  apiKey: 'es.openai.apiKey.v1',
  memorySuggestions: 'es.memorySuggestions.v1',
  traceEvents: 'es.trace.v1',
  serverUrl: 'es.server.url.v1',
} as const;

export const DEFAULTS = {
  dryRun: true,
  killSwitch: false,
  notifyIntervalMin: 30,
  maxCandidatesPerScan: 100,
  bodyExcerptChars: 512,
  approvalExpiryMs: 1000 * 60 * 30, // 30 minutes
} as const;

export const ALARMS = {
  periodicScan: 'es.periodicScan',
} as const;
