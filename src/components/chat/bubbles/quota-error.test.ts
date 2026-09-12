import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectQuotaError, resetCountdown } from './quota-error.ts';

const MUSE_429 =
  '[muse error] API error 429 [request_id=5e4998f9-c4f0-436e-bd62-8b44d6868b94]: ' +
  'Subscription quota exhausted. Your usage window resets at 2026-09-12T17:35:09Z. (rate_limit_error)';

describe('detectQuotaError', () => {
  it('detects the Muse 429 with provider + reset instant', () => {
    const q = detectQuotaError(MUSE_429);
    assert.ok(q);
    assert.equal(q.provider, 'Muse');
    assert.equal(q.resetsAt?.toISOString(), '2026-09-12T17:35:09.000Z');
  });

  it('detects generic provider shapes', () => {
    assert.ok(detectQuotaError('API error 429: rate limit exceeded, retry later'));
    assert.ok(detectQuotaError('Out of credit — please top up and retry'));
    assert.ok(detectQuotaError('credits exhausted for this key'));
  });

  it('ignores ordinary text and bare numbers', () => {
    assert.equal(detectQuotaError('The answer is 42, done.'), null);
    assert.equal(detectQuotaError('See error 429 in the docs'), null);
    assert.equal(detectQuotaError(''), null);
  });
});

describe('resetCountdown', () => {
  it('formats minutes and hours', () => {
    const now = Date.parse('2026-09-12T17:00:00Z');
    assert.equal(resetCountdown(new Date('2026-09-12T17:35:09Z'), now), 'en 35 min');
    assert.equal(resetCountdown(new Date('2026-09-12T19:05:00Z'), now), 'en 2 h 05 min');
  });

  it('returns null for past or unknown resets', () => {
    assert.equal(resetCountdown(null), null);
    assert.equal(resetCountdown(new Date('2026-09-12T16:00:00Z'), Date.parse('2026-09-12T17:00:00Z')), null);
  });
});
