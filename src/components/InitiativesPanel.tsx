/**
 * InitiativesPanel — central roadmap view (M4.2 · V90).
 *
 * Renders initiatives as cards with expand-to-task-grid layout.
 * Real-time: reads from `serverStore` memos, which refresh on
 * `state.rebuilt` / `task.updated` events wired in App.tsx, so
 * frontmatter mutations propagate without operator action.
 *
 * V90 header layout (left → right):
 *   INITIATIVES · [active | archived | all | backlog] · [filter…] · RUN ALL
 *
 * The right-side status pills (all/active/next/backlog) are gone —
 * "next" was redundant with active visibility, and the meaningful
 * distinctions (archived / completed / backlog) now live as
 * VISIBILITY modes on the left. RUN ALL kicks the sequential
 * orchestrator (RoadmapRunner + roadmapRunStore) over every
 * currently-visible non-complete non-backlog initiative.
 */

import { For, Show, createSignal, createMemo } from 'solid-js';
import { allInitiatives, allTasks, isProjectEmpty, type ServerInitiative, type ServerTask } from '~/state/server';
import InitiativeCard from '~/components/InitiativeCard';
import EmptyOnboardingPanel from '~/components/EmptyOnboardingPanel';
import { viewStore } from '~/state/view';
import { roadmapRunStore } from '~/state/roadmap-run';
import { startRoadmapRun, stopRoadmapRun } from '~/components/story/RoadmapRunner';
import { storyStore } from '~/state/story';

// V90 — visibility modes replace the old visibility + status-filter
// duo. `backlog` joins the family so the operator can park ideas
// without polluting the active roadmap.
type VisibilityFilter = 'active' | 'archived' | 'all' | 'backlog';

const VISIBILITY_FILTERS: { id: VisibilityFilter; label: string; title: string }[] = [
  { id: 'active',   label: 'active',   title: 'Initiatives in flight or up next — the operative roadmap' },
  { id: 'archived', label: 'archived', title: 'Initiatives the operator manually archived' },
  { id: 'all',      label: 'all',      title: 'Everything — active, archived, completed, backlog, mixed' },
  { id: 'backlog',  label: 'backlog',  title: 'Ideas parked outside the active roadmap' },
];

export default function InitiativesPanel() {
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
    const vis = visibility();
    const tbi = tasksByInitiative();
    return allInitiatives().filter((it) => {
      const arch = viewStore.isInitiativeArchived(it.id);
      const tasks = tbi.get(it.id) ?? [];
      const complete = tasks.length > 0 && tasks.every((t) => t.status === 'done');
      const isBacklog = it.status === 'backlog';
      // V90 — visibility modes:
      //   active:   not archived, not complete, not backlog
      //   archived: only the manually-archived
      //   backlog:  only `status === 'backlog'`, not archived
      //   all:      everything (mixed)
      if (vis === 'active' && (arch || complete || isBacklog)) return false;
      if (vis === 'archived' && !arch) return false;
      if (vis === 'backlog' && (arch || !isBacklog)) return false;
      if (!q) return true;
      const hay = `${it.title} ${it.id} ${it.oneliner ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  });

  // V90 — RUN ALL state. Derived from the roadmap-run store so the
  // button reflects a multi-tab in-flight pass too.
  const roadmapActive = () => roadmapRunStore.isActive();
  const roadmapProgress = (): { cursor: number; total: number } | null => {
    const r = roadmapRunStore.state.run;
    if (!r || !roadmapActive()) return null;
    return { cursor: r.cursor, total: r.queue.length };
  };
  /** Any other story currently busy on the daemon — disables RUN ALL
   *  to avoid clobbering manual work. */
  const otherStoryBusy = () => {
    const r = storyStore.state.run;
    if (!r) return false;
    if (roadmapActive() && roadmapRunStore.currentInitiativeId() === r.initiativeId) return false;
    return r.status === 'running' && r.live;
  };
  const onRunAll = (): void => {
    if (roadmapActive()) {
      void stopRoadmapRun();
      return;
    }
    // Build queue from the currently-visible active list, restricted
    // to initiatives that have at least one open task. Stable order
    // = the order the operator sees on screen.
    const list = filtered()
      .filter((it) => {
        if (viewStore.isInitiativeArchived(it.id)) return false;
        if (it.status === 'backlog') return false;
        const tasks = tasksByInitiative().get(it.id) ?? [];
        if (tasks.length === 0) return false;
        return tasks.some((t) => t.status !== 'done' && t.status !== 'cancelled');
      })
      .map((it) => it.id);
    if (list.length === 0) return;
    startRoadmapRun(list);
  };

  return (
    <section class="min-w-0 p-4">
      <Show when={!isProjectEmpty()} fallback={<EmptyOnboardingPanel />}>
        <header class="flex flex-wrap items-center gap-2 mb-4">
          <h2 class="text-sm font-mono uppercase tracking-wider text-gray-500">Initiatives</h2>
          {/* V90 — visibility modes (active · archived · all · backlog) */}
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
                  title={f.title}
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
            class="bg-gray-900/60 border border-gray-800 rounded-md px-3 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 w-44"
          />
          <div class="ml-auto flex items-center">
            <button
              type="button"
              onClick={onRunAll}
              disabled={!roadmapActive() && (otherStoryBusy() || filtered().length === 0)}
              title={
                roadmapActive()
                  ? 'Cancel the in-flight roadmap pass (the current initiative is also cancelled)'
                  : otherStoryBusy()
                    ? 'Another initiative is running — stop it before starting a roadmap pass'
                    : 'Execute every visible non-backlog initiative, sequentially, on fresh agents'
              }
              class={`px-3 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-wider transition-colors border disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 ${
                roadmapActive()
                  ? 'bg-red-500/15 hover:bg-red-500/30 text-red-300 border-red-500/40'
                  : 'bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
              }`}
            >
              <Show when={roadmapActive()} fallback={<>▶▶  Run all</>}>
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" aria-hidden="true" />
                <span>Stop all</span>
                <Show when={roadmapProgress()}>
                  <span class="font-mono text-[10px] opacity-70">
                    {roadmapProgress()!.cursor + 1}/{roadmapProgress()!.total}
                  </span>
                </Show>
              </Show>
            </button>
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
