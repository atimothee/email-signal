/// <reference types="node" />
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  __test,
  upsertDecisionVectors,
  searchDecisions,
  upsertMemoryVector,
  searchMemories,
  vectorIndexStatus,
} from './vector-index.js';

/**
 * Unit tests for the best-effort RediSearch vector index (#33/#35) + the
 * degradation/privacy/isolation guarantees from #38. There is no real Redis in
 * CI, so a FakeRedis implements just enough of HSET + FT.SEARCH (KNN by cosine)
 * to exercise the encode → query → parse path and the account TAG filter.
 */

const PREFIX_BY_INDEX: Record<string, string> = {
  'es:idx:decision': 'es:vec:decision:',
  'es:idx:mem': 'es:vec:mem:',
};

/** Decode a little-endian Float32 buffer back to a number[]. */
function fromBuf(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < buf.length; i += 4) out.push(buf.readFloatLE(i));
  return out;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i]! * b[i]!;
  return s;
}

class FakeRedis {
  hashes = new Map<string, Map<string, string | Buffer>>();
  async hset(...args: (string | Buffer | number)[]): Promise<number> {
    const key = String(args[0]);
    const h = this.hashes.get(key) ?? new Map();
    for (let i = 1; i < args.length; i += 2) {
      h.set(String(args[i]), args[i + 1] as string | Buffer);
    }
    this.hashes.set(key, h);
    return 1;
  }
  async expire(): Promise<number> {
    return 1;
  }
  async call(command: string, ...args: (string | Buffer | number)[]): Promise<unknown> {
    if (command === 'FT.CREATE') return 'OK';
    if (command === 'FT.SEARCH') {
      const indexName = String(args[0]);
      const query = String(args[1]);
      const prefix = PREFIX_BY_INDEX[indexName] ?? '';
      // Parse @account:{hash}, optional @kind:{val}, KNN k, and the $BLOB param.
      const accountMatch = query.match(/@account:\{([^}]+)\}/);
      const account = accountMatch ? accountMatch[1]!.replace(/\\/g, '') : '';
      const kindMatch = query.match(/@kind:\{([^}]+)\}/);
      const kindFilter = kindMatch ? kindMatch[1]!.replace(/\\/g, '') : null;
      const kMatch = query.match(/KNN\s+(\d+)/);
      const k = kMatch ? Number(kMatch[1]) : 10;
      const blobIdx = args.findIndex((a) => a === 'BLOB');
      const blob = args[blobIdx + 1] as Buffer;
      const qvec = fromBuf(blob);

      const scored: Array<{ key: string; fields: Map<string, string | Buffer>; dist: number }> = [];
      for (const [key, fields] of this.hashes) {
        if (!key.startsWith(prefix)) continue;
        if (String(fields.get('account')) !== account) continue;
        if (kindFilter && String(fields.get('kind')) !== kindFilter) continue;
        const vec = fields.get('vec');
        if (!(vec instanceof Buffer)) continue;
        scored.push({ key, fields, dist: 1 - dot(qvec, fromBuf(vec)) });
      }
      scored.sort((a, b) => a.dist - b.dist);
      const top = scored.slice(0, k);
      // Flat reply: [total, key, [f,v,...,'score',dist], ...]
      const reply: unknown[] = [top.length];
      for (const hit of top) {
        const flat: (string | Buffer)[] = [];
        for (const [f, v] of hit.fields) {
          if (f === 'vec') continue; // RETURN never asks for the raw vector
          flat.push(f, v);
        }
        flat.push('score', String(hit.dist));
        reply.push(hit.key, flat);
      }
      return reply;
    }
    return null;
  }
}

let fake: FakeRedis;
beforeEach(() => {
  fake = new FakeRedis();
  __test.setClient(fake as unknown as Parameters<typeof __test.setClient>[0]);
});

// L2-normalized toy vectors (any length works — encoding is length-agnostic).
const vA = [1, 0, 0];
const vB = [0, 1, 0];

test('disabled: every op is a silent no-op, no throw on the request path', async () => {
  __test.reset(); // no client + REDIS_URL unset in test env
  assert.equal(vectorIndexStatus().status, 'disabled');
  await assert.doesNotReject(
    upsertDecisionVectors('a@x.com', [decision('d1', 'Pay rent')], [vA])
  );
  assert.deepEqual(await searchDecisions('a@x.com', vA, 5), []);
  assert.deepEqual(await searchMemories('a@x.com', vA, 5), []);
});

test('decision round-trip: nearest vector is returned with high similarity', async () => {
  await upsertDecisionVectors('a@x.com', [decision('d1', 'Pay rent'), decision('d2', 'Reply to Maya')], [vA, vB]);
  const hits = await searchDecisions('a@x.com', vA, 5);
  assert.equal(hits[0]?.title, 'Pay rent');
  assert.ok(hits[0]!.similarity > 0.99, `similarity ${hits[0]?.similarity}`);
  // The non-matching decision ranks lower (orthogonal → similarity ~0).
  assert.ok((hits[1]?.similarity ?? 0) < 0.5);
});

test('account isolation: account B never sees account A vectors', async () => {
  await upsertDecisionVectors('a@x.com', [decision('d1', 'A secret decision')], [vA]);
  const a = await searchDecisions('a@x.com', vA, 5);
  const b = await searchDecisions('b@x.com', vA, 5);
  assert.equal(a.length, 1);
  assert.equal(b.length, 0, 'account B must not see account A vectors');
});

test('privacy: only the derived allowlist + vector are stored — never raw bodies', async () => {
  await upsertDecisionVectors('a@x.com', [decision('d1', 'Pay rent')], [vA]);
  const stored = [...fake.hashes.values()][0]!;
  const fields = new Set(stored.keys());
  const allowed = new Set(['account', 'id', 'title', 'why', 'kind', 'urgency', 'createdAt', 'emailIds', 'vec']);
  for (const f of fields) assert.ok(allowed.has(f), `unexpected stored field: ${f}`);
  // Explicitly assert no body-ish field leaked in.
  for (const banned of ['body', 'bodyExcerpt', 'snippet', 'raw', 'content'])
    assert.ok(!fields.has(banned), `body field leaked: ${banned}`);
});

test('memory round-trip + kind filter', async () => {
  await upsertMemoryVector('u', { id: 'm1', summary: 'prefers morning meetings', kind: 'preference', createdAt: iso() }, vA);
  await upsertMemoryVector('u', { id: 'm2', summary: 'likes the weekly digest', kind: 'topic_interest', createdAt: iso() }, vB);
  const all = await searchMemories('u', vA, 5);
  assert.equal(all[0]?.summary, 'prefers morning meetings');
  // kind filter restricts the candidate set.
  const onlyTopic = await searchMemories('u', vA, 5, 'topic_interest');
  assert.equal(onlyTopic.length, 1);
  assert.equal(onlyTopic[0]?.id, 'm2');
});

function decision(id: string, title: string) {
  return { id, title, why: 'because', kind: 'money', urgency: 'high', createdAt: iso(), emailIds: ['e1'] };
}
function iso() {
  return '2026-06-07T00:00:00.000Z';
}
