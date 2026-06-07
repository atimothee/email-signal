import { STORAGE_KEYS } from '@/common/constants';
import { USER_ID } from '@/agents/runtime';
import { getMemoryStore } from '@/memory';
import type { ActionLedgerEntry } from '@schemas/index';

/**
 * Multi-account migration (issue #5).
 *
 * Before #5 there was a single user keyed `local-user`. When the first *real*
 * inbox connects we hand that legacy memory + ledger to it, so preferences the
 * user already taught Email Signal don't vanish the moment accounts become
 * real. This runs exactly once (guarded by `legacyMigrated`): the legacy data
 * is absorbed by whichever account connects first and is NOT copied into any
 * later account — otherwise account A's prefs would leak into account B, the
 * exact isolation the issue is about.
 *
 * Strictly additive: it never deletes `local-user` data and only writes into an
 * empty target, so a stray re-run before the flag is set still can't clobber a
 * real account's own data.
 */
export async function migrateLegacyAccount(toAccountId: string): Promise<void> {
  if (!toAccountId || toAccountId === USER_ID) return;
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

  const flag = (await chrome.storage.local.get(STORAGE_KEYS.legacyMigrated))[
    STORAGE_KEYS.legacyMigrated
  ];
  if (flag) return; // legacy data already absorbed by the first account

  const store = await getMemoryStore();

  // Preferences: copy local-user -> account only when the account has none yet.
  const legacyPrefs = await store.listPreferences(USER_ID);
  if (legacyPrefs.length > 0) {
    const targetPrefs = await store.listPreferences(toAccountId);
    if (targetPrefs.length === 0) {
      for (const p of legacyPrefs) await store.upsertPreference(toAccountId, p);
    }
  }

  // Memory records: same additive copy.
  const legacyRecs = await store.recallMemories(USER_ID);
  if (legacyRecs.length > 0) {
    const targetRecs = await store.recallMemories(toAccountId);
    if (targetRecs.length === 0) {
      for (const r of legacyRecs) await store.appendMemory(toAccountId, r);
    }
  }

  // Ledger: the on-disk shape is `{ [accountId]: entry[] }` (see local-ledger),
  // but legacy data may still be the old flat array. Normalise, then copy the
  // legacy slice into the account if the account has none.
  const raw = (await chrome.storage.local.get(STORAGE_KEYS.ledger))[STORAGE_KEYS.ledger];
  const map: Record<string, ActionLedgerEntry[]> = Array.isArray(raw)
    ? { [USER_ID]: raw as ActionLedgerEntry[] }
    : ((raw as Record<string, ActionLedgerEntry[]>) ?? {});
  const legacyLedger = map[USER_ID] ?? [];
  if (legacyLedger.length > 0 && (map[toAccountId]?.length ?? 0) === 0) {
    map[toAccountId] = [...legacyLedger];
    await chrome.storage.local.set({ [STORAGE_KEYS.ledger]: map });
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.legacyMigrated]: true });
}
