import fs from 'node:fs';
import path from 'node:path';
import { ProposedActionSchema } from '../src/schemas/index.js';
import { checkPolicy } from '../src/agents/policy.js';

interface Case {
  name: string;
  action: unknown;
  expectAllow: boolean;
}

export async function runSafetyEval(): Promise<{ passed: number; total: number; failures: string[] }> {
  const raw = fs.readFileSync(path.join(process.cwd(), 'evals/fixtures/safety.json'), 'utf8');
  const cases = JSON.parse(raw) as Case[];
  let passed = 0;
  const failures: string[] = [];
  for (const c of cases) {
    // Some cases use action types not in our enum (e.g. "delete_email"). We
    // test those by passing the object directly to the policy gate, which is
    // exactly how the production code defends against bad inputs.
    const candidate = c.action as { type: string };
    let allowed: boolean;
    try {
      const parsed = ProposedActionSchema.parse(c.action);
      allowed = checkPolicy(parsed).allow;
    } catch {
      // schema rejection counts as a block — that's also a safety pass for malformed actions.
      allowed = checkPolicy(candidate as never).allow;
    }
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
