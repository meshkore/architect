import type { ServerTask } from '~/state/server';

export const PHASE_ORDER = ['foundation', 'setup', 'build', 'test', 'docs', 'ship'];

/**
 * Sort tasks by the operator's MANUAL order — the numeric task id
 * sequence (`1`, `1.1`, `2`, …) — and NOTHING else.
 *
 * Pre-2026-07-11 this bucketed by status first (active → top, done →
 * bottom). That silently rewrote the roadmap: as a queue ran, finished
 * tasks sank to the bottom and pending ones floated up, so the list no
 * longer matched the order the operator curated. Operator field report:
 * "las desordenan — quiero que el orden manual sea el que mando". Now
 * status is a per-row *tint* only (the glyph + colour on each row already
 * distinguishes done/working/pending); the vertical order stays put, so a
 * done task #1 renders at the top as done, the live task #3 sits third,
 * and so on down the list exactly as authored.
 */
export function sortTasks(tasks: ServerTask[]): ServerTask[] {
  return [...tasks].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

export function phaseOf(t: ServerTask): string {
  const s = `${t.title ?? ''} ${t.id ?? ''}`.toLowerCase();
  if (/\b(migration|migrate|schema|db init|sql|foundation)\b/.test(s)) return 'foundation';
  if (/\b(deploy|release|publish|rollout|ship)\b/.test(s)) return 'ship';
  if (/\b(doc|docs|documentation|readme|notes)\b/.test(s)) return 'docs';
  if (/\b(test|tests|smoke|verify|qa)\b/.test(s)) return 'test';
  return 'build';
}

export function groupByPhases(sorted: ServerTask[]): [string, ServerTask[]][] {
  const buckets = new Map<string, ServerTask[]>();
  for (const t of sorted) {
    const k = phaseOf(t);
    const a = buckets.get(k);
    if (a) a.push(t); else buckets.set(k, [t]);
  }
  return PHASE_ORDER.flatMap((p) => {
    const arr = buckets.get(p);
    return arr ? [[p, arr] as [string, ServerTask[]]] : [];
  });
}
