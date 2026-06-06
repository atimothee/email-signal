import fs from 'node:fs';
import path from 'node:path';
import {
  ClutterFindingSchema,
  EmailCandidateSchema,
} from '../../src/schemas/index.js';
import { quickPriorityPass } from '../../src/agents/heuristics.js';
import {
  synthesizeActionItemsLocal,
  applyVisibilityFloor,
} from '../../src/agents/synthesis.js';

interface Assertions {
  minItems?: number;
  maxItems?: number;
  verbLed?: boolean;
  shortWhy?: boolean;
  noClutterSources?: boolean;
  hasSources?: boolean;
  confidenceFloor?: number;
  excludedEmailIds?: string[];
  expectMultipleSources?: boolean;
  shouldShowEmptyState?: boolean;
}

interface Case {
  name: string;
  candidates: unknown[];
  clutter: unknown[];
  assertions: Assertions;
}

const VERB_RE = /^[A-Z][a-z]+\b/;

function checkVerbLed(action: string): boolean {
  if (action.length > 100) return false;
  return VERB_RE.test(action);
}

function checkShortWhy(why: string): boolean {
  if (why.length > 200) return false;
  // Allow up to two sentences ("." plus optional trailing).
  const parts = why.split(/[.!?]/).map((p) => p.trim()).filter(Boolean);
  return parts.length <= 2;
}

export async function runPrioritySynthesisEval(): Promise<{
  passed: number;
  total: number;
  failures: string[];
}> {
  const raw = fs.readFileSync(
    path.join(process.cwd(), 'evals/priority/synthesis.fixtures.json'),
    'utf8'
  );
  const cases = JSON.parse(raw) as Case[];
  let passed = 0;
  const failures: string[] = [];

  for (const c of cases) {
    const candidates = c.candidates.map((r) => EmailCandidateSchema.parse(r));
    const clutter = c.clutter.map((r) => ClutterFindingSchema.parse(r));
    const clutterIds = new Set(clutter.map((cl) => cl.emailId));
    const priorities = candidates
      .filter((cand) => !clutterIds.has(cand.id))
      .map((cand) => quickPriorityPass(cand))
      .filter((p): p is NonNullable<typeof p> => !!p);

    const raw_items = synthesizeActionItemsLocal({
      priorities,
      clutter,
      candidates,
    });
    const visible = c.assertions.shouldShowEmptyState
      ? applyVisibilityFloor(raw_items)
      : raw_items;

    const errs: string[] = [];
    const a = c.assertions;
    if (typeof a.minItems === 'number' && visible.length < a.minItems) {
      errs.push(`expected ≥${a.minItems} items, got ${visible.length}`);
    }
    if (typeof a.maxItems === 'number' && visible.length > a.maxItems) {
      errs.push(`expected ≤${a.maxItems} items, got ${visible.length}`);
    }
    if (a.shouldShowEmptyState && visible.length !== 0) {
      errs.push(`expected empty-state (0 visible), got ${visible.length}`);
    }
    for (const item of visible) {
      if (a.verbLed && !checkVerbLed(item.action)) {
        errs.push(`action not verb-led / too long: "${item.action}"`);
      }
      if (a.shortWhy && !checkShortWhy(item.why)) {
        errs.push(`why too long or multi-sentence: "${item.why}"`);
      }
      if (a.hasSources && item.sources.length < 1) {
        errs.push(`item ${item.id} has 0 sources`);
      }
      if (typeof a.confidenceFloor === 'number' && item.confidence < a.confidenceFloor) {
        errs.push(`item below floor ${a.confidenceFloor}: ${item.confidence.toFixed(2)}`);
      }
      if (a.noClutterSources) {
        for (const s of item.sources) {
          if (clutterIds.has(s.emailId)) {
            errs.push(`item references clutter source ${s.emailId}`);
          }
        }
      }
      if (a.excludedEmailIds?.length) {
        for (const s of item.sources) {
          if (a.excludedEmailIds.includes(s.emailId)) {
            errs.push(`item references excluded source ${s.emailId}`);
          }
        }
      }
    }
    if (a.expectMultipleSources) {
      const okMulti = visible.some((i) => i.sources.length >= 2);
      if (!okMulti) errs.push('expected at least one item to merge ≥2 sources');
    }

    if (errs.length === 0) {
      passed++;
    } else {
      failures.push(`case "${c.name}": ${errs.join('; ')}`);
    }
  }

  return { passed, total: cases.length, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPrioritySynthesisEval().then((r) => {
    console.log(`Priority synthesis eval: ${r.passed}/${r.total}`);
    r.failures.forEach((f) => console.log('  ✗', f));
    process.exit(r.passed === r.total ? 0 : 1);
  });
}
