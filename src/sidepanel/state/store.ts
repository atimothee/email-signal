import { create } from 'zustand';
import type {
  AccountIdentity,
  ActionLedgerEntry,
  AgentTraceEvent,
  ClutterFinding,
  ClutterSenderGroup,
  DailyBrief,
  Decision,
  ExtMessage,
  MemorySuggestion,
  PriorityFinding,
  ProposedAction,
  ScanResult,
} from '@schemas/index';

/** Honest scan lifecycle — drives the Ambient Pulse and Today states. */
export type ScanStatus = 'idle' | 'reading' | 'thinking' | 'done' | 'error';

interface PanelState {
  apiKey: string;
  dryRun: boolean;
  killSwitch: boolean;

  /** The mail account the active tab is signed in as, or null if unknown. */
  account: AccountIdentity | null;

  scan: ScanResult | null;
  scanStatus: ScanStatus;
  scanProgress: { loaded: number; target: number };
  decisions: Decision[];
  /** One-sentence "here's your day" synthesis, or null. */
  daySummary: string | null;
  clutter: ClutterFinding[];
  groups: ClutterSenderGroup[];
  priorities: PriorityFinding[];
  brief: DailyBrief | null;
  proposedActions: Record<string, ProposedAction>;
  ledger: ActionLedgerEntry[];
  memorySuggestions: MemorySuggestion[];
  traceEvents: AgentTraceEvent[];
  lastError: string | null;

  ingest: (msg: ExtMessage) => void;
  dismissMemorySuggestion: (id: string) => void;
  removeProposedAction: (id: string) => void;
  /** Optimistically drop a decision (handled/snoozed); restore on undo. */
  removeDecision: (id: string) => void;
  restoreDecision: (decision: Decision) => void;
  setApiKey: (k: string) => void;
  setDryRun: (b: boolean) => void;
  setKillSwitch: (b: boolean) => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  apiKey: '',
  dryRun: true,
  killSwitch: false,
  account: null,
  scan: null,
  scanStatus: 'idle',
  scanProgress: { loaded: 0, target: 0 },
  decisions: [],
  daySummary: null,
  clutter: [],
  groups: [],
  priorities: [],
  brief: null,
  proposedActions: {},
  ledger: [],
  memorySuggestions: [],
  traceEvents: [],
  lastError: null,
  ingest: (msg) =>
    set((s) => {
      switch (msg.kind) {
        case 'bg/scan_complete':
          return { scan: msg.scan };
        case 'bg/turn_started':
          // A fresh scan clears stale results so the user never sees old data
          // while we re-read. Other triggers just show a working state.
          return msg.trigger === 'scan'
            ? {
                scanStatus: 'reading',
                scanProgress: { loaded: 0, target: 0 },
                decisions: [],
                daySummary: null,
                groups: [],
                lastError: null,
              }
            : { scanStatus: 'thinking' };
        case 'bg/scan_progress':
          return {
            scanStatus: msg.phase,
            scanProgress: {
              loaded: msg.loaded,
              target: msg.target ?? s.scanProgress.target,
            },
          };
        case 'bg/turn_done':
          return { scanStatus: msg.ok ? 'done' : 'error' };
        case 'bg/decisions':
          return { decisions: msg.decisions, daySummary: msg.summary ?? null };
        case 'bg/classification':
          return {
            clutter: msg.clutter,
            groups: msg.groups,
            priorities: msg.priorities,
          };
        case 'bg/brief':
          return { brief: msg.brief };
        case 'bg/proposed_action':
          return {
            proposedActions: { ...s.proposedActions, [msg.action.id]: msg.action },
          };
        case 'bg/memory_suggestion':
          return { memorySuggestions: [...s.memorySuggestions, msg.suggestion] };
        case 'bg/ledger_entry': {
          const idx = s.ledger.findIndex((e) => e.id === msg.entry.id);
          const next = [...s.ledger];
          if (idx >= 0) next[idx] = msg.entry;
          else next.push(msg.entry);
          return { ledger: next };
        }
        case 'bg/trace_event':
          return { traceEvents: [...s.traceEvents, msg.event].slice(-300) };
        case 'bg/account_identity':
          return { account: msg.identity };
        case 'bg/chat_reply':
          // Legacy reply path; CopilotKit renders chat now. Ignored.
          return {};
        case 'bg/error':
          return { lastError: msg.message, scanStatus: 'error' };
        default:
          return {};
      }
    }),
  dismissMemorySuggestion: (id) =>
    set((s) => ({ memorySuggestions: s.memorySuggestions.filter((m) => m.id !== id) })),
  removeProposedAction: (id) =>
    set((s) => {
      const next = { ...s.proposedActions };
      delete next[id];
      return { proposedActions: next };
    }),
  removeDecision: (id) =>
    set((s) => ({ decisions: s.decisions.filter((d) => d.id !== id) })),
  restoreDecision: (decision) =>
    set((s) =>
      s.decisions.some((d) => d.id === decision.id)
        ? {}
        : { decisions: [...s.decisions, decision] }
    ),
  setApiKey: (k) => set({ apiKey: k }),
  setDryRun: (b) => set({ dryRun: b }),
  setKillSwitch: (b) => set({ killSwitch: b }),
}));
