import type { ServerTask } from '~/state/server';

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  next: 1,
  planned: 2,
  backlog: 3,
  blocked: 4,
  done: 5,
};

export const PHASE_ORDER = ['foundation', 'setup', 'build', 'test', 'docs', 'ship'];

export function sortTasks(tasks: ServerTask[]): ServerTask[] {
  return [...tasks].sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 9;
    const sb = STATUS_ORDER[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
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
