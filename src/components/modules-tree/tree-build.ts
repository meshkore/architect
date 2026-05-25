import { allModules, allTasks, type ServerModule } from '~/state/server';
import type { ModuleTreeIndex } from '~/components/ModuleNode';

const ACTIVE_STATUSES = new Set(['active', 'next', 'planned', 'in-progress', 'in_progress', 'doing']);

export function buildModuleTree(): ModuleTreeIndex {
  const mods = allModules();
  const tasks = allTasks();
  const byParent = new Map<string, ServerModule[]>();
  const byId = new Map<string, ServerModule>();
  const own = new Map<string, { total: number; active: number }>();
  for (const m of mods) byId.set(m.id, m);
  for (const m of mods) {
    const p = (m.parent as string | undefined) && byId.has(m.parent as string) ? (m.parent as string) : '__root__';
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(m);
    own.set(m.id, { total: 0, active: 0 });
  }
  for (const t of tasks) {
    const cat = (t.category ?? t.module) as string | undefined;
    if (!cat || !own.has(cat)) continue;
    const c = own.get(cat)!;
    c.total += 1;
    if (ACTIVE_STATUSES.has((t.status ?? '').toLowerCase())) c.active += 1;
  }
  const agg = new Map<string, { total: number; active: number }>();
  const collect = (id: string): { total: number; active: number } => {
    const cached = agg.get(id);
    if (cached) return cached;
    const o = own.get(id) ?? { total: 0, active: 0 };
    let total = o.total;
    let active = o.active;
    for (const k of byParent.get(id) ?? []) {
      const c = collect(k.id);
      total += c.total;
      active += c.active;
    }
    const r = { total, active };
    agg.set(id, r);
    return r;
  };
  for (const m of mods) collect(m.id);
  for (const list of byParent.values()) {
    list.sort((a, b) => {
      if (a.id === 'project') return -1;
      if (b.id === 'project') return 1;
      const ca = agg.get(a.id)!;
      const cb = agg.get(b.id)!;
      return (cb.active - ca.active) || (cb.total - ca.total) || (a.name ?? a.id).localeCompare(b.name ?? b.id);
    });
  }
  return { byParent, byId, agg };
}

export function modulePasses(id: string, tree: ModuleTreeIndex, pill: 'all' | 'work' | 'stb'): boolean {
  if (pill === 'all') return true;
  const { byParent, agg } = tree;
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const a = agg.get(cur)?.active ?? 0;
    const isLeaf = !(byParent.get(cur)?.length);
    if (pill === 'work' && a > 0) return true;
    if (pill === 'stb' && a === 0 && isLeaf) return true;
    for (const k of byParent.get(cur) ?? []) stack.push(k.id);
  }
  return false;
}
