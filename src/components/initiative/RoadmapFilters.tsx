/**
 * RoadmapFilters — the roadmap header: queue chip, status chips,
 * expand/collapse-all, text filter.
 *
 * QUEUE sits apart from the rest (cyan, own gap): it is NOT part of the
 * task catalog — it's the live, operator-managed execution wall, and
 * putting it in the same row as the status filters read as "another
 * status".
 */

import { For, Show } from 'solid-js';
import { TabButton } from '~/components/ui/TabButton';

export type VisibilityFilter = 'all' | 'active' | 'backlog' | 'archived' | 'queue';

// Order requested by operator 2026-06-19: all · active · backlog · archived.
const VISIBILITY_FILTERS: { id: VisibilityFilter; label: string; title: string }[] = [
  { id: 'all',      label: 'all',      title: 'Everything — active, archived, completed, backlog, mixed' },
  { id: 'active',   label: 'active',   title: 'Initiatives in flight or up next — the operative roadmap' },
  { id: 'backlog',  label: 'backlog',  title: 'Ideas parked outside the active roadmap' },
  { id: 'archived', label: 'archived', title: 'Initiatives the operator manually archived' },
];

export function RoadmapFilters(props: {
  visibility: VisibilityFilter;
  onVisibility: (f: VisibilityFilter) => void;
  queueCount: number;
  query: string;
  onQuery: (q: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <header class="initiatives-header rt-header">
      <div class="initiatives-filters flex items-center flex-shrink-0">
        <TabButton
          tone="info"
          active={props.visibility === 'queue'}
          onClick={() => props.onVisibility('queue')}
          title="Execution queue — stories queued or running now"
          class="inline-flex items-center gap-1.5"
        >
          <>
            queue
            <Show when={props.queueCount > 0}>
              <span class="rt-queue-count">{props.queueCount}</span>
            </Show>
          </>
        </TabButton>
        <span class="rt-filter-sep" aria-hidden="true" />
        <div class="flex items-center gap-1">
          <For each={VISIBILITY_FILTERS}>
            {(f) => (
              <TabButton
                tone="warn"
                active={props.visibility === f.id}
                onClick={() => props.onVisibility(f.id)}
                title={f.title}
              >
                {f.label}
              </TabButton>
            )}
          </For>
        </div>
      </div>

      {/* Expand-all / collapse-all — open every story AND every task body
          so the operator can read the whole history without clicking. */}
      <div class="rt-expand-group ml-auto flex items-center gap-0.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => props.onExpandAll()}
          class="rt-expand-btn"
          title="Expand all stories and tasks — read everything at a glance"
          aria-label="Expand all"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
            stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M7 9l5-5 5 5" />
            <path d="M7 15l5 5 5-5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => props.onCollapseAll()}
          class="rt-expand-btn"
          title="Collapse all stories and tasks"
          aria-label="Collapse all"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
            stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M7 4l5 5 5-5" />
            <path d="M7 20l5-5 5 5" />
          </svg>
        </button>
      </div>

      <input
        type="text"
        placeholder="Filter…"
        value={props.query}
        onInput={(e) => props.onQuery((e.currentTarget as HTMLInputElement).value)}
        class="initiatives-filter-input bg-gray-800/70 border border-gray-600 rounded-md px-3 py-1 text-xs text-gray-100 placeholder-gray-400 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/40 w-44 min-w-0"
      />
      {/* RUN ALL removed 2026-06-19 — redundant with the queue's "Run
          queue"; execution happens only from the Queue wall. Staging is
          per-story ▶. */}
    </header>
  );
}

export default RoadmapFilters;
