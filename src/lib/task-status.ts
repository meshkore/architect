/**
 * task-status.ts — how a task's status counts toward "is this finished?".
 *
 * RSV1. The daemon publishes a canonical status per task. Most of them mean
 * "there is work here"; two mean the opposite, and they mean it differently:
 *
 *   done       the work was carried out
 *   cancelled  the work was closed WITHOUT being carried out — abandoned,
 *              superseded, or measured and found not worth doing
 *
 * Both are resolved. Neither is pending. The distinction matters for the
 * progress bar: a cancelled task must not sit in the denominator, or an
 * initiative that is genuinely finished shows "6/7" forever and never reads
 * as complete. `daemon-audit-hardening` was the case that surfaced this —
 * six tasks delivered, one cancelled after being measured.
 *
 * Before py-1.35.3 the daemon collapsed `cancelled` to `backlog` on the wire,
 * so none of this could be expressed; the two call sites that already tested
 * for `'cancelled'` were dead code waiting for the other half.
 */
import type { ServerTask } from '~/state/server';

type HasStatus = Pick<ServerTask, 'status'>;

const norm = (t: HasStatus): string => (t.status || '').toLowerCase();

/** Closed on purpose, never carried out. Not pending, not an achievement. */
export function isCancelled(t: HasStatus): boolean {
  return norm(t) === 'cancelled';
}

export function isDone(t: HasStatus): boolean {
  return norm(t) === 'done';
}

/** The tasks that count toward progress: everything except the cancelled
 *  ones, which are neither numerator nor denominator. */
export function countable<T extends HasStatus>(tasks: readonly T[]): T[] {
  return tasks.filter((t) => !isCancelled(t));
}

/**
 * Done / total, with cancelled tasks excluded from both.
 * `total: 0` when an initiative has no tasks, or every one was cancelled.
 */
export function taskProgress(tasks: readonly HasStatus[]): {
  done: number;
  total: number;
  pct: number;
} {
  const counted = countable(tasks);
  const done = counted.filter(isDone).length;
  const total = counted.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * True when every task that was going to be done, is done.
 *
 * Requires at least one countable task, which is the same guard the daemon's
 * archive reconciler applies: an initiative whose tasks were ALL cancelled
 * was abandoned, not completed, and must not read as finished.
 */
export function allTasksComplete(tasks: readonly HasStatus[]): boolean {
  const { done, total } = taskProgress(tasks);
  return total > 0 && done === total;
}
