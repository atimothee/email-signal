/// <reference types="node" />
import type { DecisionOut } from './agents.js';
import { embedTexts, cosine } from './embeddings.js';

/**
 * Vector dedup for draft decisions.
 *
 * When synthesis produces more than the short-list cap across batches, the
 * pipeline used to make an extra LLM call to merge duplicates. That call is
 * ~100× the cost of an embedding and non-deterministic. This replaces it: embed
 * each draft's (title, why), cluster near-duplicates by cosine similarity, and
 * merge each cluster with a deterministic rule.
 *
 * Returns { clustered: false } on ANY embedding failure so the caller can fall
 * back to the LLM consolidation path — embeddings are an optimization, never a
 * dependency.
 */

/**
 * Cosine threshold for treating two drafts as the same underlying decision.
 * Calibrated on text-embedding-3-small: paraphrases of the same ask score
 * ~0.84–0.88, while genuinely distinct asks sit ~0.20–0.33 — a wide gap. 0.80
 * sits below the lowest observed duplicate with margin, far above any distinct
 * pair. Tunable via EMAIL_SIGNAL_DEDUP_THRESHOLD.
 */
const THRESHOLD = Number(process.env['EMAIL_SIGNAL_DEDUP_THRESHOLD'] ?? 0.8);

const URGENCY_RANK: Record<string, number> = { critical: 3, high: 2, normal: 1, low: 0 };

export interface DedupResult {
  merged: DecisionOut[];
  /** false when embeddings were unavailable — caller should use its fallback. */
  clustered: boolean;
  /**
   * text→vector map of every draft we embedded, keyed by `embedText(draft)`.
   * Threaded out so the caller (the synthesis pipeline) can persist the final
   * decisions to the Context Retriever index WITHOUT a second embedding call.
   * Present only when `clustered` (i.e. embeddings succeeded). The merged reps'
   * titles/whys are a subset of these keys, so lookups hit.
   */
  vectorsByText?: Map<string, number[]>;
}

/** Stable key for the (title, why) we embed — shared with the index write path. */
export function embedText(d: { title: string; why: string }): string {
  return `${d.title}\n${d.why}`;
}

/**
 * Greedy single-linkage clustering: each draft joins the first existing cluster
 * it is ≥THRESHOLD similar to (by max similarity to any member), else seeds a
 * new one. Drafts are few (≤ a few dozen), so the O(n²) scan is trivial.
 */
function clusterByCosine(vectors: number[][]): number[][] {
  const clusters: number[][] = []; // each is a list of draft indices
  for (let i = 0; i < vectors.length; i++) {
    let placed = false;
    for (const cluster of clusters) {
      const sim = Math.max(...cluster.map((j) => cosine(vectors[i]!, vectors[j]!)));
      if (sim >= THRESHOLD) {
        cluster.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([i]);
  }
  return clusters;
}

/** Deterministic merge of one cluster of drafts into a single DecisionOut. */
function mergeCluster(drafts: DecisionOut[]): DecisionOut {
  // Representative = highest confidence, tie-break by lexicographically smallest
  // title, so the output is byte-stable across runs (keeps the cache stable too).
  const rep = [...drafts].sort(
    (a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title)
  )[0]!;

  const emailIds = Array.from(new Set(drafts.flatMap((d) => d.emailIds))).sort();
  const senders = Array.from(new Set(drafts.flatMap((d) => d.senders))).slice(0, 6);
  const urgency = drafts
    .map((d) => d.urgency)
    .reduce((a, b) => (URGENCY_RANK[b]! > URGENCY_RANK[a]! ? b : a));
  const confidence = Math.max(...drafts.map((d) => d.confidence));
  // Prefer a concrete due date if any sibling has one (earliest wins).
  const dueDates = drafts.map((d) => d.dueAt).filter((x): x is string => !!x).sort();

  return {
    ...rep,
    emailIds,
    senders,
    urgency,
    confidence,
    dueAt: dueDates[0] ?? rep.dueAt ?? null,
  };
}

export async function dedupDecisions(
  drafts: DecisionOut[],
  apiKey?: string
): Promise<DedupResult> {
  if (drafts.length <= 1) return { merged: drafts, clustered: true };

  let vectors: number[][];
  try {
    vectors = await embedTexts(drafts.map(embedText), apiKey);
  } catch {
    return { merged: drafts, clustered: false }; // signal: use LLM fallback
  }
  if (vectors.length !== drafts.length) return { merged: drafts, clustered: false };

  const clusters = clusterByCosine(vectors);
  const merged = clusters
    .map((idxs) => mergeCluster(idxs.map((i) => drafts[i]!)))
    .sort(
      (a, b) =>
        (URGENCY_RANK[b.urgency]! - URGENCY_RANK[a.urgency]!) || b.confidence - a.confidence
    );

  // Expose the draft vectors keyed by their embed text so the caller can index
  // the final decisions without re-embedding (every merged rep's text is a key).
  const vectorsByText = new Map<string, number[]>();
  for (let i = 0; i < drafts.length; i++) vectorsByText.set(embedText(drafts[i]!), vectors[i]!);

  return { merged, clustered: true, vectorsByText };
}
