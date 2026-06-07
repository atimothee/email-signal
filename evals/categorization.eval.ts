import fs from 'node:fs';
import path from 'node:path';
import { EmailCandidate, EmailCandidateSchema } from '../src/schemas/index.js';
import { runAgentClassification } from '../server/agents.js';

/**
 * Theme-categorization eval.
 *
 * Golden dataset (evals/fixtures/categorization.json) of real-world emails with
 * the theme the DecisionSynthesizer should assign. This is the dataset we grow
 * over time and run as a Weave Evaluation in W&B (wandb.ai): set WANDB_API_KEY
 * (and optionally WANDB_PROJECT) and the run is logged there for comparison
 * across prompt/model changes.
 *
 * Because it exercises the live Agents SDK it needs OPENAI_API_KEY. With no key
 * it SKIPS (0/0) so the deterministic eval suite still runs key-free in CI.
 */

interface Case {
  name: string;
  from: { name?: string; email: string };
  subject: string;
  snippet: string;
  hasUnsubscribeLink?: boolean;
  /** Whether this email should become a Decision at all (vs. filtered as clutter). */
  expectSurfaces: boolean;
  /** Required theme when it surfaces. */
  expectedTheme?: string;
  /** Theme it must NOT be assigned (e.g. a deploy "job" must not be theme=job). */
  forbiddenTheme?: string;
  notes?: string;
}

interface Prediction {
  surfaced: boolean;
  theme: string | null;
}

interface Result {
  passed: number;
  total: number;
  failures: string[];
}

const noopWriter = { send: async () => {} };

function loadDataset(): Case[] {
  const raw = fs.readFileSync(path.join(process.cwd(), 'evals/fixtures/categorization.json'), 'utf8');
  return JSON.parse(raw) as Case[];
}

function toCandidate(c: Case): EmailCandidate {
  return EmailCandidateSchema.parse({
    id: c.name,
    threadId: c.name,
    provider: 'gmail',
    from: c.from,
    subject: c.subject,
    snippet: c.snippet,
    bodyExcerpt: c.snippet,
    isUnread: true,
    hasUnsubscribeLink: c.hasUnsubscribeLink ?? false,
  });
}

/** Run the real clutter→synthesis pipeline over a single email. */
async function classify(c: Case): Promise<Prediction> {
  const { decisions } = await runAgentClassification({
    turnId: `cat-${c.name}`,
    candidates: [toCandidate(c)],
    writer: noopWriter,
  });
  const decision = decisions.find((d) => d.emailIds.includes(c.name)) ?? decisions[0];
  return { surfaced: !!decision, theme: decision?.theme ?? null };
}

/**
 * Memoize `classify` by case name so each case is classified at most once,
 * whether the call originates from the Weave Evaluation's model op or the local
 * pass/total summary loop. This lets the Weave Evaluation be the single real
 * classification run while the local summary replays the same predictions for
 * free. Tradeoff: a case whose first attempt THREW is not cached (the rejected
 * promise is dropped), so it may be retried once by the local loop — acceptable
 * since classification errors are rare and we want the local failure report.
 */
function makeClassifyMemo() {
  const cache = new Map<string, Promise<Prediction>>();
  return (c: Case): Promise<Prediction> => {
    const cached = cache.get(c.name);
    if (cached) return cached;
    const p = classify(c);
    cache.set(c.name, p);
    // Don't cache rejections: drop the entry so a thrown case can be retried.
    p.catch(() => cache.delete(c.name));
    return p;
  };
}

/** Per-row scoring shared by the local summary and the Weave scorers. */
function scoreSurfaced(c: Case, p: Prediction): boolean {
  return p.surfaced === c.expectSurfaces;
}
function scoreTheme(c: Case, p: Prediction): boolean {
  if (!c.expectSurfaces) return true; // theme N/A for clutter
  if (c.expectedTheme && p.theme !== c.expectedTheme) return false;
  if (c.forbiddenTheme && p.theme === c.forbiddenTheme) return false;
  return true;
}

function failureFor(c: Case, p: Prediction): string | null {
  if (!scoreSurfaced(c, p)) {
    return `${c.name}: expected surfaces=${c.expectSurfaces}, got ${p.surfaced}`;
  }
  if (!scoreTheme(c, p)) {
    const want = c.expectedTheme ?? `not ${c.forbiddenTheme}`;
    return `${c.name}: expected theme ${want}, got "${p.theme}"`;
  }
  return null;
}

/**
 * Run the eval AS a Weave Evaluation so it shows up in wandb.ai. The model op
 * invokes the REAL classifier per row (via the shared `classifyMemo`), so Weave
 * captures real per-case latency, inputs/outputs, and nested generation spans.
 * The local summary loop later replays the same memoized predictions for free,
 * so each case is classified exactly once. Best-effort: any failure is swallowed
 * since Weave is optional. Returns true if the Weave Evaluation actually ran
 * (so the caller knows the memo was populated by the eval).
 */
async function logToWeave(
  cases: Case[],
  classifyMemo: (c: Case) => Promise<Prediction>
): Promise<boolean> {
  if (!process.env['WANDB_API_KEY']) return false;
  try {
    const weave: any = await import('weave');
    // Eval runs land in a SEPARATE project from prod traces by default
    // (overridable via WANDB_PROJECT) so prod traces stay uncluttered (#47).
    const evalProject = process.env['WANDB_PROJECT'] ?? 'email-signal-evals';
    await weave.init(evalProject);

    const dataset = new weave.Dataset({
      id: 'email-theme-categorization',
      rows: cases.map((c) => ({
        id: c.name,
        name: c.name,
        subject: c.subject,
        from: c.from.email,
        expectSurfaces: c.expectSurfaces,
        expectedTheme: c.expectedTheme ?? null,
        forbiddenTheme: c.forbiddenTheme ?? null,
      })),
    });

    const model = weave.op(async function themeModel(input: any) {
      const row = input.datasetRow ?? input;
      const c = cases.find((x) => x.name === row.name);
      if (!c) return { surfaced: false, theme: null };
      // Real classifier work happens here, inside the Weave op, so Weave
      // captures latency, inputs/outputs, and nested generation spans per case.
      return classifyMemo(c);
    });

    const lookup = (row: any): Case => cases.find((c) => c.name === row.name)!;
    const surfacedScorer = weave.op(function surfaces({ datasetRow, modelOutput }: any) {
      return scoreSurfaced(lookup(datasetRow), modelOutput);
    });
    const themeScorer = weave.op(function theme({ datasetRow, modelOutput }: any) {
      return scoreTheme(lookup(datasetRow), modelOutput);
    });

    const evaluation = new weave.Evaluation({
      id: 'theme-categorization',
      dataset,
      scorers: [surfacedScorer, themeScorer],
    });
    await evaluation.evaluate({ model });
    console.log('  ↳ logged Weave evaluation to W&B project', evalProject);
    return true;
  } catch (err) {
    console.warn('  ↳ weave logging skipped:', (err as Error)?.message ?? err);
    return false;
  }
}

export async function runCategorizationEval(): Promise<Result & { skipped?: boolean }> {
  const cases = loadDataset();

  if (!process.env['OPENAI_API_KEY']) {
    console.log('  (categorization eval skipped: set OPENAI_API_KEY to run the live classifier)');
    return { passed: 0, total: 0, failures: [], skipped: true };
  }

  const failures: string[] = [];
  let passed = 0;

  // Single shared, memoized classifier: each case is classified at most once
  // across BOTH the Weave Evaluation (if enabled) and the local summary below.
  const classifyMemo = makeClassifyMemo();

  // When WANDB_API_KEY is set this runs the Weave Evaluation, which invokes the
  // real classifier per row and populates the memo. When it is unset this is a
  // no-op and the local loop drives `classifyMemo` directly. Either way each
  // case is classified exactly once.
  await logToWeave(cases, classifyMemo);

  for (const c of cases) {
    let prediction: Prediction;
    try {
      prediction = await classifyMemo(c);
    } catch (err) {
      failures.push(`${c.name}: classification threw — ${(err as Error)?.message ?? err}`);
      continue;
    }
    const failure = failureFor(c, prediction);
    if (failure) failures.push(failure);
    else passed++;
  }

  return { passed, total: cases.length, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCategorizationEval()
    .then((r) => {
      console.log(`Categorization eval: ${r.passed}/${r.total}${r.skipped ? ' (skipped)' : ''}`);
      r.failures.forEach((f) => console.log('  ✗', f));
      process.exit(r.failures.length === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
