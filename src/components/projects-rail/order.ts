/**
 * projects-rail/order.ts — operator-saved order of project rows.
 *
 * Mirrors the chat rail-order pattern: an array of project keys (the
 * cluster_id or `port:<n>` fallback) persisted to localStorage.
 * Anything in the array sorts in order; rows not yet listed fall
 * through to the natural order produced by rows.ts.
 */

const ORDER_KEY = 'mc-projects-order-v1';

export function loadProjectsOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveProjectsOrder(order: string[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    /* quota */
  }
}

/** Apply the saved order to a list of rows. Stable for unlisted ids. */
export function applyOrder<T extends { key: string }>(rows: T[], order: string[]): T[] {
  if (order.length === 0) return rows;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const sorted: T[] = [];
  for (const id of order) {
    const r = byKey.get(id);
    if (r) { sorted.push(r); byKey.delete(id); }
  }
  for (const r of rows) {
    if (byKey.has(r.key)) sorted.push(r);
  }
  return sorted;
}
