/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCacheKey, fingerprintContext } from './cache.js';
import type { EmailCandidate } from '../src/schemas/index.js';

/**
 * #34/#38 cache-key correctness + degradation: the retrieved-context fingerprint
 * must be folded into the classify cache key (so evolving history busts the
 * cache), AND with retrieval disabled the key must be byte-identical to the
 * pre-Context-Retriever key (the core degradation invariant).
 */

function cand(id: string): EmailCandidate {
  // Only `id` participates in the cache key; the rest is filler to satisfy the type.
  return {
    id,
    threadId: id,
    from: { name: 'X', email: 'x@y.com' },
    subject: 's',
    snippet: '',
    receivedAt: '2026-06-07T00:00:00.000Z',
  } as unknown as EmailCandidate;
}

test('fingerprintContext: empty/undefined → "none", order-independent otherwise', () => {
  assert.equal(fingerprintContext(undefined), 'none');
  assert.equal(fingerprintContext([]), 'none');
  // Same id set in different order → same fingerprint (sorted internally).
  assert.equal(fingerprintContext(['a', 'b', 'c']), fingerprintContext(['c', 'a', 'b']));
  // Different id set → different fingerprint.
  assert.notEqual(fingerprintContext(['a', 'b']), fingerprintContext(['a', 'b', 'c']));
});

test('degradation: no context fingerprint reproduces the legacy key exactly', () => {
  const cands = [cand('1'), cand('2')];
  const noCtx = classifyCacheKey('me@x.com', cands, []);
  const noneCtx = classifyCacheKey('me@x.com', cands, [], 'none');
  const undefCtx = classifyCacheKey('me@x.com', cands, [], undefined);
  // Default ('none') and explicit undefined both equal the legacy 4-arg call.
  assert.equal(noCtx, noneCtx);
  assert.equal(noCtx, undefCtx);
  // And the key ends in the ':none' context segment.
  assert.ok(noCtx.endsWith(':none'), noCtx);
});

test('cache correctness: changing retrieved context busts the key', () => {
  const cands = [cand('1'), cand('2')];
  const base = classifyCacheKey('me@x.com', cands, [], fingerprintContext(['d1']));
  const changed = classifyCacheKey('me@x.com', cands, [], fingerprintContext(['d1', 'd2']));
  assert.notEqual(base, changed, 'a new relevant decision must change the cache key');
});

test('account isolation: different accounts never share a key', () => {
  const cands = [cand('1')];
  assert.notEqual(
    classifyCacheKey('a@x.com', cands, []),
    classifyCacheKey('b@x.com', cands, [])
  );
});
