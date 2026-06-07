import { runSafetyEval } from './safety.eval.js';
import { runMemoryEval } from './memory.eval.js';
import { runHandoffsEval } from './handoffs.eval.js';
import { runSynthesisEval } from './synthesis.eval.js';

interface Result { name: string; passed: number; total: number; failures: string[] }

async function main() {
  const results: Result[] = [];
  results.push({ name: 'safety', ...(await runSafetyEval()) });
  results.push({ name: 'memory', ...(await runMemoryEval()) });
  results.push({ name: 'handoffs', ...(await runHandoffsEval()) });
  results.push({ name: 'synthesis', ...(await runSynthesisEval()) });

  let okAll = true;
  for (const r of results) {
    const ok = r.passed === r.total;
    okAll = okAll && ok;
    console.log(`${ok ? '✓' : '✗'} ${r.name}: ${r.passed}/${r.total}`);
    r.failures.forEach((f) => console.log('    ', f));
  }
  process.exit(okAll ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
