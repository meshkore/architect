/**
 * RoadmapList — V86i.
 *
 * Tasks list, scoped by the operator's selection in the Modules tree.
 * Adds a breadcrumb above the search bar so the operator can see (and
 * navigate) the current scope at a glance:
 *
 *   All projects (root) → modules › submodule
 *
 * Each segment is clickable: clicking a parent re-scopes the list,
 * clicking the root ("All") clears the module filter. The empty-state
 * panel now spells out which scope returned zero matches and offers a
 * "Clear filters" button so the operator can recover in one click.
 */

import { For, Show, createSignal, createMemo } from 'solid-js';
import { store, type Task } from '~/state/store';
import { allModules } from '~/state/server';

const STATUSES = ['next', 'in_progress', 'done', 'backlog', 'blocked'] as const;
type Status = typeof STATUSES[number];

interface Crumb { id: string | null; label: string; }

function moduleChain(moduleId: string | null): Crumb[] {
  const mods = allModules();
  const byId = new Map(mods.map((m) => [m.id, m]));
  const chain: Crumb[] = [];
  let cur: string | null = moduleId;
  while (cur) {
    const m = byId.get(cur);
    if (!m) break;
    chain.unshift({ id: m.id, label: (m.name as string | undefined) ?? m.id });
    const parent = (m.parent as string | undefined) ?? null;
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return chain;
}

export default function RoadmapList(props: { moduleId: string | null; onSelectModule?: (id: string | null) => void }) {
  const [statusFilter, setStatusFilter] = createSignal<Status | 'all'>('all');
  const [query, setQuery] = createSignal('');

  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim();
    return store.tasks().filter((t) => {
      if (props.moduleId && t.category !== props.moduleId) return false;
      if (statusFilter() !== 'all' && t.status !== statusFilter()) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.id.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  const crumbs = createMemo<Crumb[]>(() => moduleChain(props.moduleId));
  const hasFilters = () => statusFilter() !== 'all' || query().trim() !== '' || props.moduleId !== null;

  const onCrumbClick = (id: string | null): void => {
    if (props.onSelectModule) props.onSelectModule(id);
  };
  const clearFilters = (): void => {
    setStatusFilter('all');
    setQuery('');
    if (props.onSelectModule) props.onSelectModule(null);
  };

  return (
    <section class="min-w-0">
      <div class="sticky top-14 bg-gray-950/85 backdrop-blur-md py-3 -mt-3 z-20 space-y-2">
        <Breadcrumb crumbs={crumbs()} onSelect={onCrumbClick} />
        <div class="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search…"
            value={query()}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            class="bg-gray-900/60 border border-gray-800 rounded-md px-3 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 w-44"
          />
          <div class="flex items-center gap-1 flex-wrap">
            <FilterPill label="All" active={statusFilter() === 'all'} onClick={() => setStatusFilter('all')} />
            <For each={STATUSES}>
              {(s) => <FilterPill label={s.replace('_', ' ')} active={statusFilter() === s} onClick={() => setStatusFilter(s)} />}
            </For>
          </div>
          <Show when={hasFilters()}>
            <button
              type="button"
              onClick={clearFilters}
              class="ml-auto px-2.5 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider text-gray-500 hover:text-emerald-300 border border-transparent hover:border-emerald-500/30 transition-colors"
              title="Clear scope, search and status filter"
            >
              clear filters
            </button>
          </Show>
        </div>
      </div>

      <Show when={filtered().length > 0} fallback={<EmptyState crumbs={crumbs()} onClear={clearFilters} hasFilters={hasFilters()} />}>
        <ul class="space-y-2">
          <For each={filtered()}>
            {(t) => <TaskRow task={t} />}
          </For>
        </ul>
      </Show>

      <p class="text-xs text-gray-600 mt-6">
        {filtered().length} of {scopedTotal(props.moduleId)} task{scopedTotal(props.moduleId) === 1 ? '' : 's'} in this scope · driven live by daemon · last refresh{' '}
        {store.snapshot.generated_at ? <time class="font-mono">{new Date(store.snapshot.generated_at).toLocaleTimeString()}</time> : 'pending'}
      </p>
    </section>
  );
}

function scopedTotal(moduleId: string | null): number {
  return store.tasks().filter((t) => !moduleId || t.category === moduleId).length;
}

function Breadcrumb(props: { crumbs: Crumb[]; onSelect: (id: string | null) => void }) {
  return (
    <nav aria-label="Tasks scope" class="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider flex-wrap">
      <button
        type="button"
        onClick={() => props.onSelect(null)}
        class={`px-1.5 py-0.5 rounded transition-colors ${
          props.crumbs.length === 0
            ? 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/30'
            : 'text-gray-500 hover:text-emerald-300 border border-transparent'
        }`}
      >
        All projects
      </button>
      <For each={props.crumbs}>
        {(c, i) => (
          <>
            <span class="text-gray-700" aria-hidden="true">›</span>
            <button
              type="button"
              onClick={() => props.onSelect(c.id)}
              class={`px-1.5 py-0.5 rounded transition-colors ${
                i() === props.crumbs.length - 1
                  ? 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/30'
                  : 'text-gray-400 hover:text-emerald-300 border border-transparent'
              }`}
            >
              {c.label}
            </button>
          </>
        )}
      </For>
    </nav>
  );
}

function FilterPill(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`px-2.5 py-1 rounded-md text-[11px] font-mono uppercase tracking-wider transition-colors ${
        props.active
          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
          : 'text-gray-500 hover:text-gray-300 border border-transparent'
      }`}
    >
      {props.label}
    </button>
  );
}

function TaskRow(props: { task: Task }) {
  const [open, setOpen] = createSignal(false);
  return (
    <li class="bg-gray-900/40 border border-gray-800/70 rounded-lg overflow-hidden hover:border-gray-700 transition-colors">
      <button
        type="button"
        onClick={() => setOpen(!open())}
        class="w-full px-4 py-3 flex items-start gap-3 text-left"
      >
        <StatusBadge status={props.task.status} />
        <div class="flex-1 min-w-0">
          <div class="text-sm text-gray-100 font-medium truncate">{props.task.title}</div>
          <div class="text-xs text-gray-500 mt-0.5 font-mono">
            {props.task.id}
            <Show when={props.task.category}>
              <span class="text-gray-700"> · </span>{props.task.category}
            </Show>
            <Show when={props.task.priority}>
              <span class="text-gray-700"> · </span>{props.task.priority}
            </Show>
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class={`text-gray-600 flex-shrink-0 transition-transform ${open() ? 'rotate-180' : ''}`}>
          <path d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <Show when={open()}>
        <div class="px-4 pb-3 pt-1 border-t border-gray-800/60 text-xs text-gray-500 font-mono break-all">
          <For each={Object.entries(props.task)}>
            {([k, v]) => (
              <div class="flex gap-2 py-0.5">
                <span class="text-gray-600 min-w-[7rem]">{k}</span>
                <span class="text-gray-400">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </li>
  );
}

function StatusBadge(props: { status: string }) {
  const cls = () => {
    switch (props.status) {
      case 'done': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'in_progress': return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
      case 'next': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'blocked': return 'bg-red-500/15 text-red-300 border-red-500/30';
      case 'cancelled': return 'bg-gray-700/40 text-gray-500 border-gray-700';
      default: return 'bg-gray-800/60 text-gray-400 border-gray-700';
    }
  };
  return (
    <span class={`px-2 py-0.5 rounded-md border text-[10px] font-mono uppercase tracking-wider flex-shrink-0 mt-0.5 ${cls()}`}>
      {props.status.replace('_', ' ')}
    </span>
  );
}

function EmptyState(props: { crumbs: Crumb[]; hasFilters: boolean; onClear: () => void }) {
  const scopeLabel = props.crumbs.length === 0 ? 'All projects' : props.crumbs[props.crumbs.length - 1]!.label;
  return (
    <div class="text-center py-20 text-gray-500 space-y-3">
      <p class="text-sm">No tasks match the current filter in <span class="text-gray-300 font-mono">{scopeLabel}</span>.</p>
      <Show when={props.hasFilters}>
        <button
          type="button"
          onClick={props.onClear}
          class="px-3 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 hover:bg-emerald-500/20 transition-colors"
        >
          Clear filters
        </button>
      </Show>
    </div>
  );
}
