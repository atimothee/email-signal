import fs from 'node:fs';
import path from 'node:path';
import { quickClutterPass } from '../src/agents/heuristics.js';
import { EmailCandidateSchema } from '../src/schemas/index.js';

interface Case {
  candidate: unknown;
  expectedCategory: string | null;
  expectedAction: string | null;
}

export async function runClutterEval(): Promise<{ passed: number; total: number; failures: string[] }> {
  const raw = fs.readFileSync(path.join(process.cwd(), 'evals/fixtures/clutter.json'), 'utf8');
  const cases = JSON.parse(raw) as Case[];
  let passed = 0;
  const failures: string[] = [];
  for (const c of cases) {
    const candidate = EmailCandidateSchema.parse(c.candidate);
    const finding = quickClutterPass(candidate);
    const okCat = (finding?.category ?? null) === c.expectedCategory;
    const okAct = (finding?.suggestedAction ?? null) === c.expectedAction;
    if (okCat && okAct) {
      passed++;
    } else {
      failures.push(
        `case ${candidate.id}: expected ${c.expectedCategory}/${c.expectedAction}, got ${finding?.category ?? 'null'}/${finding?.suggestedAction ?? 'null'}`
      );
    }
  }
  return { passed, total: cases.length, failures };
}

// Allow running standalone via `tsx evals/clutter.eval.ts`.
if (import.meta.url === `file://${process.argv[1]}`) {
  runClutterEval().then((r) => {
    console.log(`Clutter eval: ${r.passed}/${r.total}`);
    r.failures.forEach((f) => console.log('  ✗', f));
    process.exit(r.passed === r.total ? 0 : 1);
  });
}
