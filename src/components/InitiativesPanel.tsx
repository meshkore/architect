/**
 * InitiativesPanel — central roadmap view (M4.2).
 *
 * Renders initiatives as cards with expand-to-task-grid layout.
 * Real-time: reads from `serverStore` memos, which refresh on
 * `state.rebuilt` / `task.updated` events wired in App.tsx, so
 * frontmatter mutations propagate without operator action.
 */

import { For, Show, createSignal, createMemo } from 'solid-js';
import { allInitiatives, allTasks, isProjectEmpty, type ServerInitiative, type ServerTask } from '~/state/server';
import InitiativeCard from '~/components/InitiativeCard';
import EmptyOnboardingPanel from '~/components/EmptyOnboardingPanel';
import { viewStore } from '~/state/view';

type StatusFilter = 'all' | 'active' | 'next' | 'backlog';
type VisibilityFilter = 'active' | 'archived' | 'all';

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all',     label: 'all' },
  { id: 'active',  label: 'active' },
  { id: 'next',    label: 'next' },
  { id: 'backlog', label: 'backlog' },
];

const VISIBILITY_FILTERS: { id: VisibilityFilter; label: string }[] = [
  { id: 'active',   label: 'active' },
  { id: 'archived', label: 'archived' },
  { id: 'all',      label: 'all' },
];

export default function InitiativesPanel() {
  const [status, setStatus] = createSignal<StatusFilter>('all');
  const [visibility, setVisibility] = createSignal<VisibilityFilter>('active');
  const [query, setQuery] = createSignal('');

  const tasksByInitiative = createMemo(() => {
    const map = new Map<string, ServerTask[]>();
    for (const t of allTasks()) {
      if (!t.initiative) continue;
      const arr = map.get(t.initiative);
      if (arr) arr.push(t); else map.set(t.initiative, [t]);
    }
    return map;
  });

  const filtered = createMemo<ServerInitiative[]>(() => {
    const q = query().trim().toLowerCase();
    const st = status();
    const vis = visibility();
    const tbi = tasksByInitiative();
    return allInitiatives().filter((it) => {
      const arch = viewStore.isInitiativeArchived(it.id);
      // V89.3 — "complete" derived from tasks (every task done +
      // initiative has tasks). The default `active` view also hides
      // these so the operator's roadmap shrinks as work lands — the
      // ask: "a medida que las va haciendo van desapareciendo de la
      // lista, solo voy viendo lo que está pendiente". `archived`
      // and `all` still show them; `all` is the only view where the
      // operator can scan completed + pending side-by-side.
      const tasks = tbi.get(it.id) ?? [];
      const complete = tasks.length > 0 && tasks.every((t) => t.status === 'done');
      if (vis === 'active' && (arch || complete)) return false;
      if (vis === 'archived' && !arch) return false;
      if (st !== 'all' && it.status !== st) return false;
      if (!q) return true;
      const hay = `${it.title} ${it.id} ${it.oneliner ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  });

  return (
    <section class="min-w-0 p-4">
      <Show when={!isProjectEmpty()} fallback={<EmptyOnboardingPanel />}>
        <header class="flex flex-wrap items-center gap-2 mb-4">
          <h2 class="text-sm font-mono uppercase tracking-wider text-gray-500">Initiatives</h2>
          {/* V86w — visibility filter sits between the search box and
              the status pills. `active` keeps the roadmap clean; the
              operator toggles to `archived` to dig out older work. */}
          <div class="flex items-center gap-1">
            <For each={VISIBILITY_FILTERS}>
              {(f) => (
                <button
                  type="button"
                  onClick={() => setVisibility(f.id)}
                  class={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors ${
                    visibility() === f.id
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                      : 'text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                  title={
                    f.id === 'active' ? 'Hide archived initiatives'
                    : f.id === 'archived' ? 'Show only archived initiatives'
                    : 'Show both archived and active'
                  }
                >
                  {f.label}
                </button>
              )}
            </For>
          </div>
          <input
            type="text"
            placeholder="Filter…"
            value={query()}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            class="ml-auto bg-gray-900/60 border border-gray-800 rounded-md px-3 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 w-44"
          />
          <div class="flex items-center gap-1">
            <For each={FILTERS}>
              {(f) => (
                <button
                  type="button"
                  onClick={() => setStatus(f.id)}
                  class={`px-2.5 py-1 rounded-md text-[11px] font-mono uppercase tracking-wider transition-colors ${
                    status() === f.id
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                      : 'text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  {f.label}
                </button>
              )}
            </For>
          </div>
        </header>

        <Show when={filtered().length > 0} fallback={<NoMatch totalInitiatives={allInitiatives().length} />}>
          <ul class="space-y-4">
            <For each={filtered()}>
              {(it) => (
                <li>
                  <InitiativeCard
                    initiative={it}
                    tasks={tasksByInitiative().get(it.id) ?? []}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>

        <p class="text-xs text-gray-600 mt-6">
          {filtered().length} of {allInitiatives().length} initiatives · {allTasks().length} tasks · live from daemon
        </p>
      </Show>
    </section>
  );
}

function NoMatch(props: { totalInitiatives: number }) {
  return (
    <div class="text-center py-16 text-gray-500">
      <p class="text-sm">
        {props.totalInitiatives === 0
          ? 'No initiatives loaded yet.'
          : 'No initiatives match this filter.'}
      </p>
    </div>
  );
}
