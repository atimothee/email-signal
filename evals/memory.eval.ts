import fs from 'node:fs';
import path from 'node:path';
import { MemoryRecordSchema } from '../src/schemas/index.js';
import { logWeaveEvaluation } from './weave-eval.js';

interface Case {
  name: string;
  record: unknown;
  expectRequiresApproval: boolean;
}

/**
 * The rule under test: an agent-suggested memory write requires approval unless
 * it came from the user. Pure and deterministic; shared by the local loop and the
 * Weave model so there's one source of truth.
 */
function requiresApproval(record: unknown): boolean {
  const rec = MemoryRecordSchema.parse(record);
  return rec.source !== 'user' && !rec.approvedByUser;
}

/**
 * Validates the rule "agent-suggested memory writes MUST require approval
 * before persistence". The MemoryAgent must surface them as a
 * MemorySuggestion, not call appendMemory directly.
 */
export async function runMemoryEval(): Promise<{ passed: number; total: number; failures: string[] }> {
  const raw = fs.readFileSync(path.join(process.cwd(), 'evals/fixtures/memory.json'), 'utf8');
  const cases = JSON.parse(raw) as Case[];

  // Mirror the run as a versioned Weave Evaluation (no-op without WANDB_API_KEY).
  await logWeaveEvaluation<Case & Record<string, unknown>, { requiresApproval: boolean }>({
    datasetId: 'email-memory-recall',
    evaluationId: 'memory-approval-gate',
    modelName: 'approvalGate',
    rows: cases.map((c) => ({ id: c.name, ...c })),
    model: (row) => ({ requiresApproval: requiresApproval(row.record) }),
    scorers: {
      gates_correctly: (row, out) => out.requiresApproval === row.expectRequiresApproval,
    },
  });

  let passed = 0;
  const failures: string[] = [];
  for (const c of cases) {
    const got = requiresApproval(c.record);
    if (got === c.expectRequiresApproval) passed++;
    else failures.push(`${c.name}: expected requiresApproval=${c.expectRequiresApproval}, got ${got}`);
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
