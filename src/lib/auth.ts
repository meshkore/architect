/**
 * lib/auth.ts — challenge-response identity check (D-TLS-02).
 *
 * Before the cockpit trusts a daemon endpoint with sensitive data
 * (bearer token, /state contents that get rendered as roadmap), it
 * asks the daemon to prove ownership of the operator's portal-token
 * by signing a random nonce:
 *
 *   1. Cockpit picks a fresh 32-byte random nonce (`crypto.getRandomValues`).
 *   2. Cockpit fetches GET <endpoint>/auth/challenge?nonce=<n>.
 *   3. Daemon responds with `{ nonce, sig: HMAC-SHA256(portal-token, nonce), … }`.
 *   4. Cockpit computes the expected HMAC with its copy of the token and
 *      compares constant-time.
 *
 * Defeats MITM-by-cert-leak: an attacker who serves a valid TLS cert
 * for `daemon.meshkore.com` (our wildcard is intentionally public)
 * still cannot answer the challenge because they don't have the
 * operator's portal-token. The cockpit sees the mismatch and refuses
 * to attach.
 *
 * Limitations the operator should know:
 *  - First connection to a NEW cluster: no shared token yet, so we
 *    can't run the challenge. That flow falls back to manual token
 *    entry; the operator must verify the cluster_id by hand.
 *  - Daemons older than py-1.8.1 don't expose /auth/challenge; the
 *    feature flag check skips verification for them.
 */

import { log } from './log';

export interface ChallengeResponse {
  nonce: string;
  sig: string;
  alg: string;
  version?: string;
}

export type VerifyOutcome =
  | { kind: 'verified' }
  | { kind: 'unsupported' }     // daemon doesn't advertise auth.challenge
  | { kind: 'no-token' }         // cockpit has no token for this cluster yet
  | { kind: 'mismatch' }         // HMAC verification failed → MITM suspected
  | { kind: 'unreachable'; reason: string };

const ENCODER = new TextEncoder();

function bytesToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function computeHmac(token: string, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(nonce));
  return bytesToHex(sig);
}

/**
 * Run the challenge-response handshake against a daemon endpoint.
 * Pass the httpBase the cockpit intends to use; the token already
 * resolved for this cluster (or empty when unknown); and the
 * `features` array from the daemon's /health response.
 */
export async function verifyDaemonIdentity(
  httpBase: string,
  token: string,
  features: string[] | undefined,
): Promise<VerifyOutcome> {
  if (!features || !features.includes('auth.challenge')) {
    return { kind: 'unsupported' };
  }
  if (!token) return { kind: 'no-token' };

  // 32-byte random nonce, hex-encoded (matches the daemon's
  // [A-Za-z0-9._-]+ regex; hex is the most portable subset).
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let nonce = '';
  for (let i = 0; i < bytes.length; i += 1) nonce += bytes[i]!.toString(16).padStart(2, '0');

  let response: ChallengeResponse;
  try {
    const r = await fetch(`${httpBase}/auth/challenge?nonce=${nonce}`);
    if (!r.ok) return { kind: 'unreachable', reason: `HTTP ${r.status}` };
    response = (await r.json()) as ChallengeResponse;
  } catch (e) {
    return { kind: 'unreachable', reason: e instanceof Error ? e.message : String(e) };
  }
  if (response.nonce !== nonce) {
    log.warn('auth: challenge nonce echo mismatch', { sent: nonce, got: response.nonce });
    return { kind: 'mismatch' };
  }
  const expected = await computeHmac(token, nonce);
  if (!constantTimeEqual(expected, response.sig)) {
    log.warn('auth: HMAC mismatch — daemon may be impersonated', { endpoint: httpBase });
    return { kind: 'mismatch' };
  }
  return { kind: 'verified' };
}
