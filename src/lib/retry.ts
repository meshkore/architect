import type { Result } from './daemon-client';

/**
 * withAuthRetry — silently retries a `Result<T>`-returning daemon call a
 * few times, ONLY on 401, before ever surfacing an error to the UI.
 *
 * Why this exists: `DaemonClient.request()` already self-heals a single
 * 401 by re-fetching the local token and retrying once (FC-2). That covers
 * "the cached token is stale." What it does NOT cover is a genuinely
 * transient window right after the daemon (re)starts — e.g. mid a
 * self-update — where even that one retry can still land before the
 * daemon has finished settling. Observed 2026-07-09: a General-settings
 * block would 401 on first load and succeed the instant the operator
 * clicked a manual "Retry" a few seconds later — i.e. the failure was
 * time-bound, not a real auth problem. The fix is to give it those few
 * seconds automatically instead of asking the operator to notice an error
 * and click a button for something that "can't fail" from their point of
 * view. Any OTHER status (404, 500, …) is a real error and returns
 * immediately — never retried.
 */
export async function withAuthRetry<T>(
  fn: () => Promise<Result<T>>,
  delaysMs: number[] = [400, 1000, 2000],
): Promise<Result<T>> {
  let result = await fn();
  for (const delay of delaysMs) {
    if (result.ok || result.status !== 401) return result;
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await fn();
  }
  return result;
}
