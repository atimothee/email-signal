/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ignoredSenderSet,
  senderMatchesIgnored,
  filterDecisionsByPreferences,
  filterClutterByPreferences,
} from './preference-filter.js';
import type { Decision, UserPreference } from '../schemas/index.js';

/**
 * #72 Defect C: muting a sender must deterministically drop it from BOTH the
 * priority decisions and the Cleanup tab on the next scan — not rely on the
 * sidecar model honouring a prompt instruction it routinely ignores for clutter.
 */

function mutePref(domain: string): UserPreference {
  return {
    id: `mute:${domain}:1`,
    kind: 'ignored_sender',
    key: domain,
    value: domain,
    source: 'user_settings',
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z',
  };
}

function decision(id: string, senders: string[]): Decision {
  return { id, senders } as unknown as Decision;
}

function clutter(senderDomain: string) {
  return { senderDomain } as { senderDomain: string };
}

test('ignoredSenderSet: only string-valued ignored_sender prefs, lowercased', () => {
  const prefs: UserPreference[] = [
    mutePref('Acme.com'),
    { ...mutePref('x'), kind: 'important_sender' },
    { ...mutePref('y'), value: 42 } as unknown as UserPreference, // non-string value ignored
  ];
  const set = ignoredSenderSet(prefs);
  assert.deepEqual([...set], ['acme.com']);
});

test('filterClutterByPreferences: drops muted domain, keeps others; empty prefs is identity', () => {
  const items = [clutter('acme.com'), clutter('news.example.com'), clutter('keep.io')];
  const filtered = filterClutterByPreferences(items, [mutePref('acme.com')]);
  assert.deepEqual(filtered.map((i) => i.senderDomain), ['news.example.com', 'keep.io']);
  // No prefs → unchanged reference behaviour (returns all items).
  assert.equal(filterClutterByPreferences(items, []).length, 3);
});

test('filterClutterByPreferences: subdomain + case-insensitive matching', () => {
  const items = [clutter('mail.acme.com'), clutter('ACME.COM'), clutter('notacme.com')];
  const filtered = filterClutterByPreferences(items, [mutePref('acme.com')]);
  // "notacme.com" must NOT match (not a real subdomain of acme.com).
  assert.deepEqual(filtered.map((i) => i.senderDomain), ['notacme.com']);
});

test('senderMatchesIgnored: address domain and bare domain both match', () => {
  const set = ignoredSenderSet([mutePref('acme.com')]);
  assert.equal(senderMatchesIgnored('newsletter@acme.com', set), true);
  assert.equal(senderMatchesIgnored('acme.com', set), true);
  assert.equal(senderMatchesIgnored('user@other.com', set), false);
});

test('filterDecisionsByPreferences: drops a decision whose sender domain is muted', () => {
  const decisions = [
    decision('d1', ['promo@acme.com']),
    decision('d2', ['boss@work.com']),
    decision('d3', ['acme.com']),
  ];
  const filtered = filterDecisionsByPreferences(decisions, [mutePref('acme.com')]);
  assert.deepEqual(filtered.map((d) => d.id), ['d2']);
});
