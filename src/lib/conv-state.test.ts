/**
 * conv-state.test.ts — run with `npm test` (node's native TS stripping).
 *
 * These predicates decide whether the cockpit shows "▶ Run queue" or
 * "STOP" for the same run, so a regression here is visible to the
 * operator as two panels contradicting each other. The cases below are
 * the ones the three former copies disagreed on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isConvWorkingFrom,
  isArchitectConv,
  pickLatestArchitectConv,
} from './conv-state.ts';

test('isConvWorkingFrom: daemon live flag wins', () => {
  assert.equal(isConvWorkingFrom({ conv: 'a', live: true }, []), true);
  assert.equal(isConvWorkingFrom({ conv: 'a', coordinating: true }, []), true);
  assert.equal(isConvWorkingFrom({ conv: 'a', live: false }, []), false);
});

test('isConvWorkingFrom: streaming bubble covers the pre-snapshot window', () => {
  // The daemon has not reported `live` yet, but a turn is visibly
  // streaming. Dropping this fallback is what made the queue bar offer
  // "Run queue" while the chat already showed "STOP".
  const streaming = [{ kind: 'assistant', streaming: true }];
  assert.equal(isConvWorkingFrom(null, streaming), true);
  assert.equal(isConvWorkingFrom(undefined, streaming), true);
});

test('isConvWorkingFrom: a cancelled stream is not working', () => {
  assert.equal(
    isConvWorkingFrom(null, [{ kind: 'assistant', streaming: true, cancelled: true }]),
    false,
  );
});

test('isConvWorkingFrom: only the LAST message counts', () => {
  const finished = [
    { kind: 'assistant', streaming: true },
    { kind: 'user' },
  ];
  assert.equal(isConvWorkingFrom(null, finished), false);
});

test('isConvWorkingFrom: empty / missing history is not working', () => {
  assert.equal(isConvWorkingFrom(null, []), false);
  assert.equal(isConvWorkingFrom(null, undefined), false);
});

test('isArchitectConv: slug counts even when the type field is corrupt', () => {
  // V99 — a convMeta entry written by a pre-V92 bundle can lose `type`.
  assert.equal(isArchitectConv('roadmap-architect-7', undefined), true);
  assert.equal(isArchitectConv('anything', 'roadmap-architect'), true);
  assert.equal(isArchitectConv('work-CN1', 'work'), false);
});

test('pickLatestArchitectConv: newest activity wins, archived excluded', () => {
  const convs = [
    { conv: 'roadmap-architect-1', last_activity_at: '2026-08-01T10:00:00Z' },
    { conv: 'roadmap-architect-2', last_activity_at: '2026-08-27T10:00:00Z' },
    { conv: 'roadmap-architect-3', last_activity_at: '2026-08-28T10:00:00Z', archived: true },
    { conv: 'work-thing', last_activity_at: '2026-08-29T10:00:00Z' },
  ];
  assert.equal(pickLatestArchitectConv(convs), 'roadmap-architect-2');
});

test('pickLatestArchitectConv: a conv with no timestamp is still selectable', () => {
  // A conv created this session, before it has reported any activity,
  // must remain addressable or the operator loses Run All on it.
  assert.equal(
    pickLatestArchitectConv([{ conv: 'roadmap-architect-new' }]),
    'roadmap-architect-new',
  );
});

test('pickLatestArchitectConv: null when the roster has no architect', () => {
  assert.equal(pickLatestArchitectConv([]), null);
  assert.equal(pickLatestArchitectConv([{ conv: 'work-1', agent_type: 'work' }]), null);
});
