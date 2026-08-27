/**
 * result.ts — the daemon client's return contract.
 *
 * Every JSON method returns `Result<T>`; every raw-text method returns
 * `TextResult`. Neither throws for ordinary HTTP errors — callers branch
 * on `.ok`. Exceptions only escape for programmer errors (malformed URL).
 */

export type Result<T> =
  | { ok: true; data: T; status: number; daemonVersion?: string }
  | { ok: false; status: number; body: string; error?: string };

/**
 * Raw-text read result (day logs, context files, arbitrary cluster
 * markdown). Deliberately NOT `Result<string>`: these callers only ever
 * need body-or-status, and three of them shipped this exact shape long
 * before the package split — widening it would churn ~6 call sites.
 *
 * `status: 0` means the request never produced a response (network
 * failure, abort, timeout). Every other status is the daemon's.
 */
export type TextResult =
  | { ok: true; body: string }
  | { ok: false; status: number; error?: string };

export class DaemonError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DaemonError';
  }
}
