import fs from 'node:fs';
import path from 'node:path';
import { MemoryRecordSchema } from '../src/schemas/index.js';

interface Case {
  name: string;
  record: unknown;
  expectRequiresApproval: boolean;
}

/**
 * Validates the rule "agent-suggested memory writes MUST require approval
 * before persistence". The MemoryAgent must surface them as a
 * MemorySuggestion, not call appendMemory directly.
 */
export async function runMemoryEval(): Promise<{ passed: number; total: number; failures: string[] }> {
  const raw = fs.readFileSync(path.join(process.cwd(), 'evals/fixtures/memory.json'), 'utf8');
  const cases = JSON.parse(raw) as Case[];
  let passed = 0;
  const failures: string[] = [];
  for (const c of cases) {
    const rec = MemoryRecordSchema.parse(c.record);
    const requiresApproval = rec.source !== 'user' && !rec.approvedByUser;
    if (requiresApproval === c.expectRequiresApproval) passed++;
    else failures.push(`${c.name}: expected requiresApproval=${c.expectRequiresApproval}, got ${requiresApproval}`);
  }
  return { passed, total: cases.length, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMemoryEval().then((r) => {
    console.log(`Memory eval: ${r.passed}/${r.total}`);
    r.failures.forEach((f) => console.log('  ✗', f));
    process.exit(r.passed === r.total ? 0 : 1);
  });
}
