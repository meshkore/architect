/**
 * InitiativesPanel — the roadmap as a vertical timeline (one node per
 * initiative). Click a story to expand its tasks; other stories dim.
 *
 * AX14 moved the pieces out: header chips → `initiative/RoadmapFilters`,
 * the execution wall's controls → `initiative/QueueBar`, the paused-quota
 * banner → `initiative/RateLimitBanner`, the auto-archive state machine →
 * `lib/roadmap-auto-archive` (policy that must survive this panel
 * unmounting), and the queue derivation → `lib/queue#queueView`.
 *
 * What is left here is the composition: which initiatives are visible,
 * and the accordion.
 */

import { For, Show, createSignal, createMemo, createEffect } from 'solid-js';
import {
  allInitiatives,
  allTasks,
  isProjectEmpty,
  activeEntriesByInitiative,
  type ServerInitiative,
  type ServerTask,
} from '~/state/server';
import InitiativeCard from '~/components/InitiativeCard';
import EmptyOnboardingPanel from '~/components/EmptyOnboardingPanel';
import { expandAllTaskRows, collapseAllTaskRows } from '~/components/initiative/task-expand-state';
import { RoadmapFilters, type VisibilityFilter } from '~/components/initiative/RoadmapFilters';
import { QueueBar } from '~/components/initiative/QueueBar';
import { RateLimitBanner } from '~/components/initiative/RateLimitBanner';
import { viewStore } from '~/state/view';
import { runArchitectOnScope } from '~/lib/architect-dispatch';
import { queuedIds, queueView, setQueue } from '~/lib/queue';
import { EXIT_ANIM_MS, exitingInitiatives } from '~/lib/roadmap-auto-archive';

export default function InitiativesPanel() {
  // FC-2 — the visibility filter is persisted per-project in viewStore so a
  // page refresh restores the operator's tab (notably QUEUE) instead of
  // snapping back to ACTIVE. bindCluster (App bus) reloads it on project switch.
  const visibility = (): VisibilityFilter =>
    (viewStore.roadmapFilter() as VisibilityFilter | null) ?? 'active';
  const setVisibility = (f: VisibilityFilter): void => viewStore.setRoadmapFilter(f);
  const [query, setQuery] = createSignal('');

  // Accordion — only one story open at a time. `null` means all collapsed.
  // `expandAll` overrides: every story open (and every task row too) so the
  // operator can read the full history end-to-end.
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [expandAll, setExpandAll] = createSignal(false);
  const toggleOpen = (id: string) => {
    if (expandAll()) setExpandAll(false);
    setOpenId((cur) => (cur === id ? null : id));
  };
  const onExpandAll = () => {
    setExpandAll(true);
    setOpenId(null);
    expandAllTaskRows(allTasks().map((t) => t.id));
  };
  const onCollapseAll = () => {
    setExpandAll(false);
    setOpenId(null);
    collapseAllTaskRows();
  };

  const tasksByInitiative = createMemo(() => {
    const map = new Map<string, ServerTask[]>();
    for (const t of allTasks()) {
      if (!t.initiative) continue;
      const arr = map.get(t.initiative);
      if (arr) arr.push(t); else map.set(t.initiative, [t]);
    }
    return map;
  });

  const isLive = (id: string): boolean => (activeEntriesByInitiative()[id]?.length ?? 0) > 0;
  const isFresh = (id: string): boolean => viewStore.isRecentlyCreatedInit(id);

  /** The queue as executed: insertion order + live-but-not-queued. */
  const queueInitiatives = createMemo<ServerInitiative[]>(() =>
    queueView({ all: allInitiatives(), isLive }),
  );

  const filtered = createMemo<ServerInitiative[]>(() => {
    const q = query().trim().toLowerCase();
    const vis = visibility();
    const tbi = tasksByInitiative();
    const exitingSet = exitingInitiatives();
    const matchesQuery = (it: ServerInitiative): boolean =>
      !q || `${it.title} ${it.id} ${it.oneliner ?? ''}`.toLowerCase().includes(q);

    // The QUEUE tab is the same derivation as the run list, plus the
    // freshly anchor-created stories and the operator's text filter.
    if (vis === 'queue') {
      return queueView({
        all: allInitiatives(),
        isLive,
        isFresh,
        match: matchesQuery,
        floatImminent: true,
      });
    }

    const list = allInitiatives().filter((it) => {
      const isDone = it.status === 'done';
      const isArchManual = viewStore.isInitiativeArchived(it.id) && it.status !== 'active';
      const isArchived = isDone || isArchManual;
      const tasks = tbi.get(it.id) ?? [];
      const complete = tasks.length > 0 && tasks.every((t) => t.status === 'done');
      const isBacklog = it.status === 'backlog';
      if (vis === 'active') {
        if (exitingSet.has(it.id)) {
          // animating out — keep visible
        } else if (isArchived || complete || isBacklog) {
          return false;
        }
      }
      if (vis === 'archived' && !isArchived) return false;
      if (vis === 'backlog' && (isArchManual || !isBacklog)) return false;
      return matchesQuery(it);
    });

    if (vis === 'archived') {
      return list.slice().sort((a, b) => {
        const ca = String(a.completed_at ?? '');
        const cb = String(b.completed_at ?? '');
        if (!ca && !cb) return 0;
        if (!ca) return 1;
        if (!cb) return -1;
        return cb.localeCompare(ca);
      });
    }
    return list;
  });

  // Auto-prune: an initiative that finished (all tasks done, or status
  // done) leaves the queue — "execute → it's done → it's gone". Pure list
  // hygiene; nothing on the roadmap is touched here.
  createEffect(() => {
    const order = queuedIds();
    if (order.length === 0) return;
    const byId = new Map(allInitiatives().map((it) => [it.id, it] as const));
    const tbi = tasksByInitiative();
    const keep = order.filter((id) => {
      const it = byId.get(id);
      if (!it) return true; // unknown (snapshot lag) — keep, don't drop blindly
      const tasks = tbi.get(id) ?? [];
      const complete = tasks.length > 0 && tasks.every((t) => t.status === 'done');
      return it.status !== 'done' && !complete;
    });
    if (keep.length !== order.length) setQueue(keep);
  });

  /** Aggregate task progress across the whole wall (done / total). */
  const queueProgress = createMemo<{ done: number; total: number; pct: number }>(() => {
    const tbi = tasksByInitiative();
    let done = 0;
    let total = 0;
    for (const it of queueInitiatives()) {
      const tasks = tbi.get(it.id) ?? [];
      total += tasks.length;
      done += tasks.filter((t) => t.status === 'done').length;
    }
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  });

  // "Run queue" — run exactly what the operator staged (a curated
  // subset), in roadmap order, skipping anything already complete.
  const onRunQueue = async (): Promise<void> => {
    const list = queueInitiatives().filter((it) => {
      if (viewStore.isInitiativeArchived(it.id)) return false;
      const tasks = tasksByInitiative().get(it.id) ?? [];
      return tasks.some((t) => t.status !== 'done' && t.status !== 'cancelled');
    });
    if (list.length === 0) return;
    await runArchitectOnScope({
      initiatives: list.map((it) => ({ id: it.id, title: it.title })),
      display: list.length === 1 ? 'single' : 'subset',
    });
  };

  return (
    <section class="initiatives-section min-w-0 px-4 pt-1 pb-4">
      <Show when={!isProjectEmpty()} fallback={<EmptyOnboardingPanel />}>
        <div class="rt-wrap">
          <RoadmapFilters
            visibility={visibility()}
            onVisibility={setVisibility}
            queueCount={queueInitiatives().length}
            query={query()}
            onQuery={setQuery}
            onExpandAll={onExpandAll}
            onCollapseAll={onCollapseAll}
          />

          <RateLimitBanner />

          <Show when={visibility() === 'queue'}>
            <QueueBar
              queued={queueInitiatives()}
              progress={queueProgress()}
              onRun={() => { void onRunQueue(); }}
            />
          </Show>

          <Show
            when={filtered().length > 0}
            fallback={
              visibility() === 'queue'
                ? <QueueEmpty />
                : <NoMatch totalInitiatives={allInitiatives().length} />
            }
          >
            <div class="rt-timeline">
              <span class="rt-line" aria-hidden="true" />
              <ul style={{ 'list-style': 'none', margin: 0, padding: 0 }}>
                <For each={filtered()}>
                  {(it, i) => {
                    const isExitingNow = () => exitingInitiatives().has(it.id);
                    const isOpen = () => expandAll() || openId() === it.id;
                    const isDimmed = () => !expandAll() && openId() !== null && openId() !== it.id;
                    return (
                      <div
                        style={{
                          'transition-duration': `${EXIT_ANIM_MS}ms`,
                          'max-height': isExitingNow() ? '0px' : '6000px',
                          opacity: isExitingNow() ? '0' : '1',
                          // Operator 2026-06-10: when the wrapper is just
                          // hosting a visible card, let the node's halo +
                          // hover scale extend freely (`visible`). Only clip
                          // during the EXIT animation so the max-height
                          // transition reads cleanly.
                          overflow: isExitingNow() ? 'hidden' : 'visible',
                          transition: 'all .35s ease',
                        }}
                      >
                        <InitiativeCard
                          initiative={it}
                          tasks={tasksByInitiative().get(it.id) ?? []}
                          index={i() + 1}
                          isOpen={isOpen()}
                          isDimmed={isDimmed()}
                          onToggle={() => toggleOpen(it.id)}
                          archived={visibility() === 'archived'}
                        />
                      </div>
                    );
                  }}
                </For>
              </ul>
            </div>
          </Show>

          <p class="text-xs text-gray-600 mt-6">
            {filtered().length} of {allInitiatives().length} initiatives · {allTasks().length} tasks · live from daemon
          </p>
        </div>
      </Show>
    </section>
  );
}

function QueueEmpty() {
  return (
    <div class="text-center py-16 text-gray-500">
      <p class="text-sm">The queue is empty.</p>
      <p class="text-xs text-gray-600 mt-2">
        Click <span class="text-cyan-300/80">＋</span> on an <span class="text-amber-300/80">active</span> story to add it to the queue, then <span class="text-cyan-300/80">Run queue</span>. The queue is temporary — it doesn't move anything in the roadmap.
      </p>
    </div>
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
