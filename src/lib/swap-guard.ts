/**
 * swap-guard.ts — drop the results of work that belongs to a project
 * the operator has already left.
 *
 * AX5 (cockpit-excellence). Every async hydrate in the cockpit races
 * the operator's next click: fetch `/team` for project A, switch to B
 * before it lands, and the late response writes A's roster into B's
 * store. That bug shipped twice (the V107.21 conv leak, then team +
 * clients) because each call site hand-rolled its own "am I still
 * current?" check — and a check on cluster id alone is not enough:
 * on A → B → A the *first* A request is "still current" again by the
 * time it resolves, and can overwrite the second, newer one.
 *
 * So the guard is an epoch, not an id. `bumpClusterEpoch()` is called
 * on every active-cluster change; a token captured before the bump
 * never validates again.
 *
 * Deliberately dependency-free (not even the logger): stores call this
 * on every hydrate, and keeping it a pure leaf is what makes the epoch
 * rule directly testable.
 */

let epoch = 0;
let activeKey: string | null = null;

/** A capture of "which project, which visit" at the moment work started. */
export interface ClusterEpoch {
  readonly key: string | null;
  readonly epoch: number;
}

/**
 * Advance the epoch. Called by the daemon store whenever the active
 * cluster changes — including a switch back to a project already
 * visited, which is exactly the case a plain id comparison misses.
 */
export function bumpClusterEpoch(key: string | null): void {
  epoch += 1;
  activeKey = key;
}

/** Capture the current (cluster, epoch) to validate against later. */
export function captureClusterEpoch(): ClusterEpoch {
  return { key: activeKey, epoch };
}

/** True when the captured epoch is still the one the operator is in. */
export function isCurrentEpoch(token: ClusterEpoch): boolean {
  return token.epoch === epoch && token.key === activeKey;
}

/**
 * Run `fn`, then apply its result only if the operator has not moved
 * on. Returns the result when applied, `undefined` when dropped.
 *
 * Use for any store write that follows an await:
 *
 *   await withClusterGuard(() => client.team(), (roster) => teamStore.set(roster));
 */
export async function withClusterGuard<T>(
  fn: () => Promise<T>,
  apply: (value: T) => void,
): Promise<T | undefined> {
  const token = captureClusterEpoch();
  const value = await fn();
  if (!isCurrentEpoch(token)) return undefined;
  apply(value);
  return value;
}
