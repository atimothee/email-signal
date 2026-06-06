import { nanoid } from 'nanoid';
import { STORAGE_KEYS } from '@/common/constants';
import {
  ActionLedgerEntry,
  ActionLedgerEntrySchema,
  ApprovalRecord,
  ExecutedActionResult,
  ProposedAction,
} from '@schemas/index';

const memEntries: ActionLedgerEntry[] = [];

function isExtension(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

async function readAll(): Promise<ActionLedgerEntry[]> {
  if (isExtension()) {
    const v = await chrome.storage.local.get(STORAGE_KEYS.ledger);
    const raw = (v[STORAGE_KEYS.ledger] as ActionLedgerEntry[]) ?? [];
    return raw;
  }
  return [...memEntries];
}

async function writeAll(entries: ActionLedgerEntry[]): Promise<void> {
  if (isExtension()) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ledger]: entries });
  } else {
    memEntries.splice(0, memEntries.length, ...entries);
  }
}

export async function recordProposed(proposed: ProposedAction): Promise<ActionLedgerEntry> {
  const entry = ActionLedgerEntrySchema.parse({
    id: nanoid(),
    createdAt: new Date().toISOString(),
    emailId: proposed.emailId,
    threadId: proposed.threadId,
    proposed,
  });
  const all = await readAll();
  all.push(entry);
  await writeAll(all);
  return entry;
}

interface AppendArgs {
  proposedActionId: string;
  approval?: ApprovalRecord;
  executed?: ExecutedActionResult;
}

export async function appendLedger(args: AppendArgs): Promise<ActionLedgerEntry | null> {
  const all = await readAll();
  const idx = all.findIndex((e) => e.proposed.id === args.proposedActionId);
  if (idx < 0) return null;
  const cur = all[idx]!;
  const next: ActionLedgerEntry = {
    ...cur,
    approval: args.approval ?? cur.approval,
    executed: args.executed
      ? {
          id: nanoid(),
          proposedActionId: cur.proposed.id,
          type: cur.proposed.type,
          executedAt: new Date().toISOString(),
          executedBy: 'content_script',
          dryRun: false,
          result: args.executed,
        }
      : cur.executed,
  };
  all[idx] = next;
  await writeAll(all);
  return next;
}

export async function getLedger(): Promise<ActionLedgerEntry[]> {
  return await readAll();
}

export async function clearLedger(): Promise<void> {
  await writeAll([]);
}
