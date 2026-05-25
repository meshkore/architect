/**
 * ModulesTree — left rail. Reads `serverStore.modules` + `serverStore.tasks`
 * and renders the V80 monolith's module nav: filter pills (all/work/stb),
 * expand/collapse with localStorage persistence, click to set the active
 * scope. Reactive memos pick up `state.rebuilt` automatically once the WS
 * layer calls `serverStore.refresh()`.
 */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { allModules, allTasks, type ServerModule } from '~/state/server';
import { uiStore, type ModulesPill } from '~/state/ui';
import ModuleNode, { type ModuleTreeIndex } from './ModuleNode';

const EXPAND_KEY = 'meshcore-nav-expanded';
const ACTIVE_STATUSES = new Set(['active', 'next', 'planned', 'in-progress', 'in_progress', 'doing']);
const PILLS: ModulesPill[] = ['all', 'work', 'stb'];

function readExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPAND_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set(['project']);
}

export default function ModulesTree(props: { selected: string | null; onSelect: (id: string | null) => void }) {
  const [expanded, setExpanded] = createSignal<Set<string>>(readExpanded(), { equals: false });

  const tree = createMemo<ModuleTreeIndex>(() => {
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
  });

  const passes = (id: string): boolean => {
    const pill = uiStore.state.modulesPill;
    if (pill === 'all') return true;
    const { byParent, agg } = tree();
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
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(EXPAND_KEY, JSON.stringify(Array.from(next))); } catch { /* quota */ }
      return next;
    });
  };

  const rootKids = createMemo(() => (tree().byParent.get('__root__') ?? []).filter((m) => passes(m.id)));

  return (
    <nav class="text-sm select-none">
      <div class="flex items-center justify-between mb-2 px-2 gap-2">
        <span class="text-xs font-mono uppercase tracking-wider text-gray-500">Modules</span>
        <div class="flex gap-1">
          <For each={PILLS}>
            {(p) => (
              <button
                type="button"
                onClick={() => uiStore.setModulesPill(p)}
                title={p === 'work' ? 'modules with active tasks' : p === 'stb' ? 'leaf modules without active tasks' : 'all modules'}
                class={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                  uiStore.state.modulesPill === p
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200'
                }`}
              >
                {p}
              </button>
            )}
          </For>
        </div>
      </div>
      <button
        type="button"
        onClick={() => props.onSelect(null)}
        class={`w-full text-left px-2 py-1.5 rounded-md flex items-center justify-between gap-2 transition-colors ${
          props.selected === null
            ? 'bg-emerald-500/10 text-emerald-300'
            : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
        }`}
      >
        <span>All</span>
        <span class="font-mono text-[10px] text-gray-500">{allTasks().length}</span>
      </button>
      <For each={rootKids()}>
        {(m) => (
          <ModuleNode
            mod={m}
            depth={0}
            tree={tree()}
            expanded={expanded()}
            passes={passes}
            selectedId={props.selected}
            onSelect={props.onSelect}
            onToggle={toggle}
          />
        )}
      </For>
      <Show when={allModules().length === 0}>
        <p class="text-xs text-gray-600 px-2 mt-3 leading-relaxed">
          No modules declared in <span class="font-mono">cluster.yaml</span>. Add a <span class="font-mono">modules:</span> block and reload.
        </p>
      </Show>
    </nav>
  );
}
