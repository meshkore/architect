/**
 * connection-status.test.ts — the regression this module exists for.
 *
 * The shipped bug: the header pill read `phase` alone, which stays
 * 'connected' while the socket is reconnecting and even after it has
 * given up, so the operator saw a green pill over a frozen cockpit.
 * Any change that lets a non-open socket report 'connected' brings
 * that back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { linkStatusFrom, isLinkDegraded } from './link-status.ts';

test('a dead socket is never reported as connected', () => {
  // The exact case that shipped: attached, HTTP fine, socket gave up.
  assert.equal(linkStatusFrom('connected', 'fatal'), 'paused');
  assert.equal(linkStatusFrom('connected', 'closed'), 'paused');
});

test('a retrying socket reads as reconnecting, not connected', () => {
  assert.equal(linkStatusFrom('connected', 'reconnecting'), 'reconnecting');
  assert.equal(linkStatusFrom('connected', 'connecting'), 'reconnecting');
});

test('fully healthy is the only path to connected', () => {
  assert.equal(linkStatusFrom('connected', 'open'), 'connected');
});

test('the idle sliver after attach does not flash amber on every switch', () => {
  // 'idle' is the gap between attachClient() and the first dial.
  assert.equal(linkStatusFrom('connected', 'idle'), 'connected');
});

test('no attachment outranks whatever the socket says', () => {
  assert.equal(linkStatusFrom('no-daemon', 'open'), 'offline');
  assert.equal(linkStatusFrom('unauthorized', 'open'), 'offline');
  assert.equal(linkStatusFrom('error', 'fatal'), 'offline');
  assert.equal(linkStatusFrom('idle', 'open'), 'offline');
});

test('boot probing reads as reconnecting, not offline', () => {
  // Showing "offline" during the initial probe would make every cold
  // boot flash a failure state before it has actually failed.
  assert.equal(linkStatusFrom('probing', 'idle'), 'reconnecting');
  assert.equal(linkStatusFrom('connecting', 'idle'), 'reconnecting');
});

test('degraded covers exactly the two stale-data states', () => {
  assert.equal(isLinkDegraded('reconnecting'), true);
  assert.equal(isLinkDegraded('paused'), true);
  assert.equal(isLinkDegraded('connected'), false);
  assert.equal(isLinkDegraded('offline'), false);
});
