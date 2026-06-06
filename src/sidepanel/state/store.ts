import { create } from 'zustand';
import type {
  ActionItem,
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
  actionItems: ActionItem[];
  snoozedActionItemIds: string[];
  doneActionItemIds: string[];
  brief: DailyBrief | null;
  proposedActions: Record<string, ProposedAction>;
  ledger: ActionLedgerEntry[];
  memorySuggestions: MemorySuggestion[];
  traceEvents: AgentTraceEvent[];
  chat: ChatMessage[];
  lastError: string | null;

  ingest: (msg: ExtMessage) => void;
  pushChatUser: (text: string) => void;
  pushChatAssistant: (text: string) => void;
  dismissMemorySuggestion: (id: string) => void;
  removeProposedAction: (id: string) => void;
  snoozeActionItem: (id: string) => void;
  markActionItemDone: (id: string) => void;
  setApiKey: (k: string) => void;
  setDryRun: (b: boolean) => void;
  setKillSwitch: (b: boolean) => void;
}

const ACTION_ITEM_SNOOZE_KEY = 'emailsignal.actionItems.snoozed';
const ACTION_ITEM_DONE_KEY = 'emailsignal.actionItems.done';

function writeLocalIds(key: string, ids: string[]): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  chrome.storage.local.set({ [key]: ids }).catch(() => undefined);
}

export const usePanelStore = create<PanelState>((set) => ({
  apiKey: '',
  dryRun: true,
  killSwitch: false,
  scan: null,
  clutter: [],
  groups: [],
  priorities: [],
  actionItems: [],
  snoozedActionItemIds: [],
  doneActionItemIds: [],
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
        case 'bg/action_items':
          return { actionItems: msg.items };
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
  pushChatAssistant: (text) =>
    set((s) => ({
      chat: [
        ...s.chat,
        { id: `${Date.now()}-a`, role: 'assistant', text, at: new Date().toISOString() },
      ],
    })),
  dismissMemorySuggestion: (id) =>
    set((s) => ({ memorySuggestions: s.memorySuggestions.filter((m) => m.id !== id) })),
  removeProposedAction: (id) =>
    set((s) => {
      const next = { ...s.proposedActions };
      delete next[id];
      return { proposedActions: next };
    }),
  snoozeActionItem: (id) =>
    set((s) => {
      const next = Array.from(new Set([...s.snoozedActionItemIds, id]));
      writeLocalIds(ACTION_ITEM_SNOOZE_KEY, next);
      return { snoozedActionItemIds: next };
    }),
  markActionItemDone: (id) =>
    set((s) => {
      const next = Array.from(new Set([...s.doneActionItemIds, id]));
      writeLocalIds(ACTION_ITEM_DONE_KEY, next);
      return { doneActionItemIds: next };
    }),
  setApiKey: (k) => set({ apiKey: k }),
  setDryRun: (b) => set({ dryRun: b }),
  setKillSwitch: (b) => set({ killSwitch: b }),
}));
