import type { MemoryStore } from './interface';
import type { MemoryRecord, UserPreference } from '@schemas/index';

/**
 * In-browser JSON store backed by chrome.storage.local — the default in
 * extension contexts when no Redis is configured.
 *
 * For Node-side evals / scripts we re-export a thin `inMemoryStore` below.
 */
const PREF_KEY = 'es.mem.prefs';
const MEM_KEY = 'es.mem.records';

function isExtension(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

const memMap = new Map<string, UserPreference[]>();
const recMap = new Map<string, MemoryRecord[]>();

async function readAll<T>(key: string): Promise<Record<string, T[]>> {
  if (isExtension()) {
    const v = await chrome.storage.local.get(key);
    return (v[key] as Record<string, T[]>) ?? {};
  }
  return {};
}

async function writeAll<T>(key: string, val: Record<string, T[]>): Promise<void> {
  if (isExtension()) {
    await chrome.storage.local.set({ [key]: val });
  }
}

export const JsonMemoryStore: MemoryStore = {
  async listPreferences(userId) {
    if (isExtension()) {
      const all = await readAll<UserPreference>(PREF_KEY);
      return all[userId] ?? [];
    }
    return memMap.get(userId) ?? [];
  },
  async upsertPreference(userId, pref) {
    if (isExtension()) {
      const all = await readAll<UserPreference>(PREF_KEY);
      const list = all[userId] ?? [];
      const idx = list.findIndex((p) => p.id === pref.id);
      if (idx >= 0) list[idx] = pref;
      else list.push(pref);
      all[userId] = list;
      await writeAll(PREF_KEY, all);
      return;
    }
    const list = memMap.get(userId) ?? [];
    const idx = list.findIndex((p) => p.id === pref.id);
    if (idx >= 0) list[idx] = pref;
    else list.push(pref);
    memMap.set(userId, list);
  },
  async removePreference(userId, prefId) {
    if (isExtension()) {
      const all = await readAll<UserPreference>(PREF_KEY);
      const list = (all[userId] ?? []).filter((p) => p.id !== prefId);
      all[userId] = list;
      await writeAll(PREF_KEY, all);
      return;
    }
    memMap.set(userId, (memMap.get(userId) ?? []).filter((p) => p.id !== prefId));
  },
  async recallMemories(userId, query) {
    let list: MemoryRecord[];
    if (isExtension()) {
      const all = await readAll<MemoryRecord>(MEM_KEY);
      list = all[userId] ?? [];
    } else {
      list = recMap.get(userId) ?? [];
    }
    if (query?.kind) list = list.filter((m) => m.kind === query.kind);
    if (query?.q) {
      const q = query.q.toLowerCase();
      list = list.filter((m) => m.summary.toLowerCase().includes(q));
    }
    return list;
  },
  async appendMemory(userId, rec) {
    if (isExtension()) {
      const all = await readAll<MemoryRecord>(MEM_KEY);
      const list = all[userId] ?? [];
      list.push(rec);
      all[userId] = list;
      await writeAll(MEM_KEY, all);
      return;
    }
    const list = recMap.get(userId) ?? [];
    list.push(rec);
    recMap.set(userId, list);
  },
};
