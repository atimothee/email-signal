/// <reference types="node" />
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  putWorkingMemory,
  searchLongTerm,
  createLongTerm,
  agentMemoryStatus,
  __resetForTests,
} from './agent-memory.js';
import type { MemoryRecord } from '../src/schemas/index.js';

/** A valid MemoryRecord for write tests. */
function sampleRecord(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'rec-1',
    kind: 'topic_interest',
    summary: 'Cares about AI infrastructure newsletters',
    details: {},
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    source: 'agent_suggested',
    approvedByUser: true,
    ...over,
  };
}

type FetchCall = { url: string; method: string; body: unknown };

/** Install a mock fetch; returns the captured calls + a way to set the responder. */
function installFetch(
  responder: (call: FetchCall) => Promise<Response> | Response
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const call: FetchCall = { url, method: init?.method ?? 'GET', body };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { calls };
}

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const realFetch = globalThis.fetch;

describe('agent-memory (disabled)', () => {
  beforeEach(() => {
    delete process.env['AGENT_MEMORY_URL'];
    __resetForTests();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('every op is a silent no-op and fetch is never called', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch;

    const res = await searchLongTerm('a@b.com', 'anything');
    assert.deepEqual(res, []);
    await createLongTerm('a@b.com', sampleRecord());
    await putWorkingMemory('a@b.com', 'sess-1', [{ role: 'user', content: 'hi' }]);

    assert.equal(called, false);
    assert.equal(agentMemoryStatus().status, 'disabled');
  });
});

describe('agent-memory (enabled)', () => {
  beforeEach(() => {
    process.env['AGENT_MEMORY_URL'] = 'http://memory.test';
    __resetForTests();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env['AGENT_MEMORY_URL'];
  });

  test('round-trip: createLongTerm then searchLongTerm returns a matching MemoryRecord', async () => {
    let stored: { text: string; memory_type: string; id: string } | null = null;
    installFetch((call) => {
      if (call.url.endsWith('/v1/long-term-memory/')) {
        const mem = (call.body as { memories: any[] }).memories[0];
        stored = { text: mem.text, memory_type: mem.memory_type, id: mem.id };
        return jsonResponse({ status: 'ok' });
      }
      if (call.url.endsWith('/v1/long-term-memory/search')) {
        // Echo the stored memory back for the semantic query.
        return jsonResponse({
          memories: stored
            ? [{ id: stored.id, text: stored.text, memory_type: stored.memory_type, created_at: '2026-06-01T00:00:00.000Z' }]
            : [],
          total: stored ? 1 : 0,
        });
      }
      return jsonResponse({});
    });

    await createLongTerm('a@b.com', sampleRecord({ summary: 'Likes infra newsletters', kind: 'topic_interest' }));
    const results = await searchLongTerm('a@b.com', 'infrastructure');

    assert.equal(results.length, 1);
    assert.equal(results[0]!.summary, 'Likes infra newsletters');
    assert.equal(results[0]!.kind, 'topic_interest');
    assert.equal(results[0]!.source, 'system');
    assert.equal(results[0]!.approvedByUser, true);
    assert.equal(agentMemoryStatus().status, 'connected');
  });

  test('unknown memory_type from server falls back to "fact"', async () => {
    installFetch(() =>
      jsonResponse({ memories: [{ id: 'x', text: 'some derived note', memory_type: 'episodic' }] })
    );
    const results = await searchLongTerm('a@b.com', 'q');
    assert.equal(results.length, 1);
    assert.equal(results[0]!.kind, 'fact');
  });

  test('timeout / network error → searchLongTerm returns [] and status flips to error', async () => {
    installFetch(() => {
      // Simulate the AbortController firing without actually waiting 2s.
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    const results = await searchLongTerm('a@b.com', 'q');
    assert.deepEqual(results, []);
    assert.equal(agentMemoryStatus().status, 'error');
  });

  test('account isolation: account B sends a different user_id than account A', async () => {
    const { calls } = installFetch(() => jsonResponse({ memories: [] }));
    await searchLongTerm('alice@example.com', 'q');
    await searchLongTerm('bob@example.com', 'q');

    const aUid = (calls[0]!.body as { user_id: { eq: string } }).user_id.eq;
    const bUid = (calls[1]!.body as { user_id: { eq: string } }).user_id.eq;
    assert.notEqual(aUid, bUid);
    assert.match(aUid, /^[0-9a-f]{16}$/);
    assert.match(bUid, /^[0-9a-f]{16}$/);
  });

  test('anon when account absent, and same account → same user_id', async () => {
    const { calls } = installFetch(() => jsonResponse({ memories: [] }));
    await searchLongTerm(undefined, 'q');
    await searchLongTerm('alice@example.com', 'q');
    await searchLongTerm('ALICE@example.com', 'q');

    assert.equal((calls[0]!.body as any).user_id.eq, 'anon');
    assert.equal((calls[1]!.body as any).user_id.eq, (calls[2]!.body as any).user_id.eq);
  });

  test('privacy: createLongTerm body carries only allowlisted derived fields, never a body/raw', async () => {
    const { calls } = installFetch(() => jsonResponse({ status: 'ok' }));
    await createLongTerm('a@b.com', sampleRecord());

    const mem = (calls[0]!.body as { memories: Record<string, unknown>[] }).memories[0]!;
    const keys = Object.keys(mem).sort();
    assert.deepEqual(keys, ['id', 'memory_type', 'namespace', 'text', 'topics', 'user_id']);
    for (const forbidden of ['body', 'raw', 'emailBody', 'content', 'snippet', 'html']) {
      assert.ok(!(forbidden in mem), `must not send "${forbidden}"`);
    }
  });

  test('putWorkingMemory sends only role/content messages to the session endpoint', async () => {
    const { calls } = installFetch(() => jsonResponse({}));
    await putWorkingMemory('a@b.com', 'sess-42', [
      { role: 'user', content: 'scan my inbox' },
      { role: 'assistant', content: 'found 3 decisions' },
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'PUT');
    assert.ok(calls[0]!.url.endsWith('/v1/working-memory/sess-42'));
    const body = calls[0]!.body as { messages: Record<string, unknown>[]; session_id: string };
    assert.equal(body.session_id, 'sess-42');
    for (const msg of body.messages) {
      assert.deepEqual(Object.keys(msg).sort(), ['content', 'role']);
    }
  });
});
