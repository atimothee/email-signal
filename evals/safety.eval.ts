import fs from 'node:fs';
import path from 'node:path';
import { ProposedActionSchema } from '../src/schemas/index.js';
import { checkPolicy } from '../src/agents/policy.js';
import { logWeaveEvaluation } from './weave-eval.js';

interface Case {
  name: string;
  action: unknown;
  expectAllow: boolean;
}

/**
 * Run the policy gate over one case's action. This IS the model under test, used
 * by BOTH the local pass/fail loop and the Weave Evaluation, so there's a single
 * source of truth. Deterministic and pure (no LLM) — safe to call per row twice.
 */
function evaluatePolicy(action: unknown): boolean {
  // Some cases use action types not in our enum (e.g. "delete_email"). We
  // test those by passing the object directly to the policy gate, which is
  // exactly how the production code defends against bad inputs.
  try {
    const parsed = ProposedActionSchema.parse(action);
    return checkPolicy(parsed).allow;
  } catch {
    // schema rejection counts as a block — that's also a safety pass for malformed actions.
    return checkPolicy(action as never).allow;
  }
}

export async function runSafetyEval(): Promise<{ passed: number; total: number; failures: string[] }> {
  const raw = fs.readFileSync(path.join(process.cwd(), 'evals/fixtures/safety.json'), 'utf8');
  const cases = JSON.parse(raw) as Case[];

  // Mirror the run as a versioned Weave Evaluation (no-op without WANDB_API_KEY).
  await logWeaveEvaluation<Case & Record<string, unknown>, { allowed: boolean }>({
    datasetId: 'email-safety-cases',
    evaluationId: 'safety-policy',
    modelName: 'policyGate',
    rows: cases.map((c) => ({ id: c.name, ...c })),
    model: (row) => ({ allowed: evaluatePolicy(row.action) }),
    scorers: {
      allows_correctly: (row, out) => out.allowed === row.expectAllow,
    },
  });

  let passed = 0;
  const failures: string[] = [];
  for (const c of cases) {
    const allowed = evaluatePolicy(c.action);
    if (allowed === c.expectAllow) {
      passed++;
    } else {
      failures.push(`${c.name}: expected allow=${c.expectAllow}, got ${allowed}`);
    }
  }
  return { passed, total: cases.length, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSafetyEval().then((r) => {
    console.log(`Safety eval: ${r.passed}/${r.total}`);
    r.failures.forEach((f) => console.log('  ✗', f));
    process.exit(r.passed === r.total ? 0 : 1);
  });
}
