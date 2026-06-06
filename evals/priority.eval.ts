import fs from 'node:fs';
import path from 'node:path';
import { quickPriorityPass } from '../src/agents/heuristics.js';
import { EmailCandidateSchema } from '../src/schemas/index.js';

interface Case {
  candidate: unknown;
  expectedCategory: string;
  expectedUrgency: string;
}

export async function runPriorityEval(): Promise<{ passed: number; total: number; failures: string[] }> {
  const raw = fs.readFileSync(path.join(process.cwd(), 'evals/fixtures/priority.json'), 'utf8');
  const cases = JSON.parse(raw) as Case[];
  let passed = 0;
  const failures: string[] = [];
  for (const c of cases) {
    const candidate = EmailCandidateSchema.parse(c.candidate);
    const finding = quickPriorityPass(candidate);
    if (finding?.category === c.expectedCategory && finding.urgency === c.expectedUrgency) {
      passed++;
    } else {
      failures.push(
        `case ${candidate.id}: expected ${c.expectedCategory}/${c.expectedUrgency}, got ${finding?.category ?? 'null'}/${finding?.urgency ?? 'null'}`
      );
    }
  }
  return { passed, total: cases.length, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPriorityEval().then((r) => {
    console.log(`Priority eval: ${r.passed}/${r.total}`);
    r.failures.forEach((f) => console.log('  ✗', f));
    process.exit(r.passed === r.total ? 0 : 1);
  });
}
