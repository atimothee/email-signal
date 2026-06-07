import { z } from 'zod';
import {
  ClutterFindingSchema,
  PriorityFindingSchema,
  ProposedActionSchema,
  EmailCandidateSchema,
  MemoryRecordSchema,
} from '@schemas/index';
import { getMemoryStore } from '@/memory';
import { getLedger } from '@/ledger/local-ledger';
import { getServerBase } from '@/common/server-client';
import { USER_ID } from './runtime';

/**
 * Try the sidecar's semantic recall first (Context Retriever vector index +
 * Agent Memory long-term, #35/#37). Returns null on any failure or when both
 * server backends are disabled (`ok:false`) so the caller falls back to the
 * local MemoryStore (semantic-Redis or substring). Best-effort — never throws.
 */
async function recallViaSidecar(args: {
  kind?: string;
  q?: string;
}): Promise<MemoryRecordType[] | null> {
  if (!args.q?.trim()) return null; // no query → nothing semantic to do
  try {
    const base = await getServerBase();
    const res = await fetch(`${base}/memory/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: USER_ID, kind: args.kind, q: args.q, k: 10 }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; records?: unknown[] };
    if (!json.ok || !Array.isArray(json.records)) return null;
    return json.records
      .map((r) => MemoryRecordSchema.safeParse(r))
      .filter((p): p is { success: true; data: MemoryRecordType } => p.success)
      .map((p) => p.data);
  } catch {
    return null;
  }
}

type MemoryRecordType = import('@schemas/index').MemoryRecord;

/**
 * Tools are framework-agnostic descriptors. The orchestrator converts them
 * to `tool({ name, parameters, execute })` calls from `@openai/agents` when
 * the SDK is available. Each `execute` is a pure async function so they can
 * also be unit-tested in evals/ without the agent runtime.
 */

export const ToolSchemas = {
  list_clutter_findings: {
    parameters: z.object({ findings: z.array(ClutterFindingSchema) }),
    description: 'Return the final ClutterFinding list for the current scan batch.',
  },
  list_priority_findings: {
    parameters: z.object({ findings: z.array(PriorityFindingSchema) }),
    description: 'Return the final PriorityFinding list for the current scan batch.',
  },
  propose_action: {
    parameters: z.object({ action: ProposedActionSchema }),
    description: 'Create a ProposedAction. Will be vetted by ActionPolicyAgent before user sees it.',
  },
  validate_action: {
    parameters: z.object({
      action: ProposedActionSchema,
      verdict: z.enum(['allow', 'block']),
      reason: z.string().max(400),
    }),
    description: 'ActionPolicyAgent verdict for a ProposedAction.',
  },
  recall_memory: {
    parameters: z.object({ kind: z.string().optional(), q: z.string().optional() }),
    description: 'Recall memory records relevant to a kind/keyword (semantic when available).',
    async execute(args: { kind?: string; q?: string }) {
      // Prefer server-side semantic recall (vector index + Agent Memory); fall
      // back to the local store (which itself does semantic-Redis or substring).
      const viaSidecar = await recallViaSidecar(args);
      if (viaSidecar) return viaSidecar;
      const store = await getMemoryStore();
      return store.recallMemories(USER_ID, { kind: args.kind as any, q: args.q });
    },
  },
  propose_memory: {
    parameters: z.object({
      record: MemoryRecordSchema,
      rationale: z.string().max(600),
    }),
    description: 'Surface a memory write as a suggestion the user must approve.',
  },
  query_ledger: {
    parameters: z.object({
      sinceIso: z.string().datetime().optional(),
      actionType: z.string().optional(),
    }),
    description: 'Return matching entries from the action ledger.',
    async execute(args: { sinceIso?: string; actionType?: string }) {
      const all = await getLedger();
      const since = args.sinceIso ? new Date(args.sinceIso).getTime() : 0;
      return all.filter(
        (e) =>
          new Date(e.createdAt).getTime() >= since &&
          (!args.actionType || e.proposed.type === args.actionType)
      );
    },
  },
  highlight_email: {
    parameters: z.object({ rowSelector: z.string() }),
    description: 'Ask the content script to scroll-into-view and outline a Gmail row.',
  },
  normalize_candidates: {
    parameters: z.object({ candidates: z.array(EmailCandidateSchema) }),
    description: 'Dedupe + clean EmailCandidate list.',
    async execute(args: { candidates: unknown[] }) {
      const parsed = args.candidates
        .map((c) => EmailCandidateSchema.safeParse(c))
        .filter((r) => r.success)
        .map((r) => (r as any).data);
      const seen = new Set<string>();
      return parsed.filter((c: any) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    },
  },
} as const;

export type ToolName = keyof typeof ToolSchemas;
