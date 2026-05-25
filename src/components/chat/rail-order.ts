const RAIL_ORDER_KEY = 'meshcore-rail-order';

export function loadRailOrder(): string[] {
  try {
    const raw = localStorage.getItem(RAIL_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

export function saveRailOrder(order: string[]): void {
  try { localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(order)); } catch { /* quota */ }
}
