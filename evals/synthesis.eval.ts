import { resolveSenderName, brandFromDomain } from '../src/common/sender.js';

interface Result {
  passed: number;
  total: number;
  failures: string[];
}

function check(failures: string[], cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

/**
 * Sender resolution runs in the sidecar now, but the logic lives in shared
 * `src/common/sender.ts`. This guards that no surface ever shows "noreply" or a
 * raw address — one of the core product complaints.
 */
export async function runSynthesisEval(): Promise<Result> {
  const failures: string[] = [];
  let passed = 0;

  const senderCases: Array<[{ name?: string; email: string }, string]> = [
    [{ name: 'OMIG', email: 'noreply@omig.co.za' }, 'OMIG'],
    [{ email: 'noreply@omig.co.za' }, 'OMIG'],
    [{ name: 'no-reply', email: 'no-reply@marketing.acme.com' }, 'Acme'],
    [{ email: 'statements@absa.co.za' }, 'Absa'],
    [{ name: 'Maya Patel', email: 'maya@designcollab.co' }, 'Maya Patel'],
  ];
  for (const [from, expected] of senderCases) {
    const got = resolveSenderName(from);
    check(failures, got === expected, `sender: ${from.email} → expected "${expected}", got "${got}"`);
    check(failures, !got.includes('@'), `sender: "${got}" must not be a raw address`);
    check(failures, !/no.?reply/i.test(got), `sender: "${got}" must not say noreply`);
    if (got === expected && !got.includes('@') && !/no.?reply/i.test(got)) passed++;
  }

  check(failures, brandFromDomain('marketing.acme.com') === 'Acme', 'brand: marketing.acme.com → Acme');
  if (brandFromDomain('marketing.acme.com') === 'Acme') passed++;

  return { passed, total: senderCases.length + 1, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSynthesisEval().then((r) => {
    console.log(`Sender eval: ${r.passed}/${r.total}`);
    r.failures.forEach((f) => console.log('  ✗', f));
    process.exit(r.passed === r.total ? 0 : 1);
  });
}
