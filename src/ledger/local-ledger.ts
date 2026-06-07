import { nanoid } from 'nanoid';
import { STORAGE_KEYS } from '@/common/constants';
import { USER_ID, getAccountId } from '@/agents/runtime';
import {
  ActionLedgerEntry,
  ActionLedgerEntrySchema,
  ApprovalRecord,
  ExecutedActionResult,
  ProposedAction,
} from '@schemas/index';

/**
 * The ledger is partitioned per connected account (issue #5): on disk it is a
 * `{ [accountId]: ActionLedgerEntry[] }` map under STORAGE_KEYS.ledger. Public
 * functions keep their old parameterless signatures and resolve the *active*
 * account themselves via getAccountId(), so the ~14 call sites are unchanged.
 */
type LedgerMap = Record<string, ActionLedgerEntry[]>;

const memMap = new Map<string, ActionLedgerEntry[]>();

function isExtension(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

async function readMap(): Promise<LedgerMap> {
  if (isExtension()) {
    const raw = (await chrome.storage.local.get(STORAGE_KEYS.ledger))[STORAGE_KEYS.ledger];
    // Legacy flat array (pre-#5) belongs to the original single user; surface it
    // under USER_ID so it migrates cleanly into the first real account.
    if (Array.isArray(raw)) return { [USER_ID]: raw as ActionLedgerEntry[] };
    return (raw as LedgerMap) ?? {};
  }
  return Object.fromEntries(memMap);
}

async function writeMap(map: LedgerMap): Promise<void> {
  if (isExtension()) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ledger]: map });
  } else {
    memMap.clear();
    for (const [k, v] of Object.entries(map)) memMap.set(k, v);
  }
}

async function readAll(): Promise<ActionLedgerEntry[]> {
  const account = await getAccountId();
  return (await readMap())[account] ?? [];
}

async function writeAll(entries: ActionLedgerEntry[]): Promise<void> {
  const account = await getAccountId();
  const map = await readMap();
  map[account] = entries;
  await writeMap(map);
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
