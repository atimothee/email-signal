import { create } from 'zustand';
import type {
  ActionLedgerEntry,
  AgentTraceEvent,
  ClutterFinding,
  ClutterSenderGroup,
  DailyBrief,
  ExtMessage,
  MemorySuggestion,
  PriorityFinding,
  ProposedAction,
  ScanResult,
} from '@schemas/index';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

interface PanelState {
  apiKey: string;
  dryRun: boolean;
  killSwitch: boolean;

  scan: ScanResult | null;
  clutter: ClutterFinding[];
  groups: ClutterSenderGroup[];
  priorities: PriorityFinding[];
  brief: DailyBrief | null;
  proposedActions: Record<string, ProposedAction>;
  ledger: ActionLedgerEntry[];
  memorySuggestions: MemorySuggestion[];
  traceEvents: AgentTraceEvent[];
  chat: ChatMessage[];
  lastError: string | null;

  ingest: (msg: ExtMessage) => void;
  pushChatUser: (text: string) => void;
  setApiKey: (k: string) => void;
  setDryRun: (b: boolean) => void;
  setKillSwitch: (b: boolean) => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  apiKey: '',
  dryRun: true,
  killSwitch: false,
  scan: null,
  clutter: [],
  groups: [],
  priorities: [],
  brief: null,
  proposedActions: {},
  ledger: [],
  memorySuggestions: [],
  traceEvents: [],
  chat: [],
  lastError: null,
  ingest: (msg) =>
    set((s) => {
      switch (msg.kind) {
        case 'bg/scan_complete':
          return { scan: msg.scan };
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
        case 'bg/chat_reply':
          return {
            chat: [
              ...s.chat,
              { id: `${Date.now()}`, role: 'assistant', text: msg.text, at: new Date().toISOString() },
            ],
          };
        case 'bg/error':
          return { lastError: msg.message };
        default:
          return {};
      }
    }),
  pushChatUser: (text) =>
    set((s) => ({
      chat: [
        ...s.chat,
        { id: `${Date.now()}`, role: 'user', text, at: new Date().toISOString() },
      ],
    })),
  setApiKey: (k) => set({ apiKey: k }),
  setDryRun: (b) => set({ dryRun: b }),
  setKillSwitch: (b) => set({ killSwitch: b }),
}));
