/**
 * InitiativeCard — one initiative row with header + expand-to-grid.
 *
 * Header is a single horizontal line: run button, title, status badge,
 * progress (N/total). Expanded body renders a responsive 1/2/3-col
 * grid of TaskCards with reading-order arrows. Optional "Group by
 * phase" toggle renders section headers ABOVE rows (never inline).
 */

import { For, Show, createSignal, createMemo } from 'solid-js';
import type { ServerInitiative, ServerTask } from '~/state/server';
import TaskCard from '~/components/TaskCard';

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  next: 1,
  planned: 2,
  backlog: 3,
  blocked: 4,
  done: 5,
};

function sortTasks(tasks: ServerTask[]): ServerTask[] {
  return [...tasks].sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 9;
    const sb = STATUS_ORDER[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

function phaseOf(t: ServerTask): string {
  const s = `${t.title ?? ''} ${t.id ?? ''}`.toLowerCase();
  if (/\b(migration|migrate|schema|db init|sql|foundation)\b/.test(s)) return 'foundation';
  if (/\b(deploy|release|publish|rollout|ship)\b/.test(s)) return 'ship';
  if (/\b(doc|docs|documentation|readme|notes)\b/.test(s)) return 'docs';
  if (/\b(test|tests|smoke|verify|qa)\b/.test(s)) return 'test';
  return 'build';
}

const PHASE_ORDER = ['foundation', 'setup', 'build', 'test', 'docs', 'ship'];

export default function InitiativeCard(props: { initiative: ServerInitiative; tasks: ServerTask[] }) {
  const [expanded, setExpanded] = createSignal(true);
  const [groupByPhase, setGroupByPhase] = createSignal(false);

  const sorted = createMemo(() => sortTasks(props.tasks));
  const done = createMemo(() => props.tasks.filter((t) => t.status === 'done').length);

  const modules = createMemo<string[]>(() => {
    const m = new Set<string>();
    for (const t of props.tasks) {
      if (t.module) m.add(t.module);
      else if (t.category) m.add(t.category);
    }
    return [...m];
  });

  const grouped = createMemo<[string, ServerTask[]][]>(() => {
    const buckets = new Map<string, ServerTask[]>();
    for (const t of sorted()) {
      const k = phaseOf(t);
      const a = buckets.get(k);
      if (a) a.push(t); else buckets.set(k, [t]);
    }
    return PHASE_ORDER.flatMap((p) => {
      const arr = buckets.get(p);
      return arr ? [[p, arr] as [string, ServerTask[]]] : [];
    });
  });

  return (
    <article class="bg-gray-900/40 border border-gray-800/70 rounded-lg overflow-hidden">
      <header class="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => { /* run-initiative wiring lands in story runner task */ }}
          title="Run initiative"
          class="w-7 h-7 rounded-md bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 flex items-center justify-center text-xs flex-shrink-0 transition-colors"
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => setExpanded(!expanded())}
          class="flex-1 flex items-center gap-3 min-w-0 text-left"
        >
          <h3 class="text-sm font-semibold text-gray-100 truncate">{props.initiative.title}</h3>
          <Show when={props.initiative.status}>
            <StatusBadge status={props.initiative.status as string} />
          </Show>
          <Show when={modules().length > 1}>
            <span class="font-mono text-[10px] text-gray-500 uppercase tracking-wider flex-shrink-0">
              {modules().length} modules
            </span>
          </Show>
          <span class="ml-auto font-mono text-[11px] text-gray-500 flex-shrink-0">
            {done()}/{props.tasks.length}
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class={`text-gray-600 flex-shrink-0 transition-transform ${expanded() ? 'rotate-180' : ''}`}
          >
            <path d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </header>

      <Show when={expanded()}>
        <div class="border-t border-gray-800/60 px-4 py-3">
          <Show when={props.tasks.length > 0} fallback={<NoTasks />}>
            <div class="flex items-center justify-end mb-3">
              <label class="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={groupByPhase()}
                  onChange={(e) => setGroupByPhase((e.currentTarget as HTMLInputElement).checked)}
                  class="accent-emerald-500"
                />
                Group by phase
              </label>
            </div>
            <Show
              when={groupByPhase()}
              fallback={<TaskGrid tasks={sorted()} />}
            >
              <For each={grouped()}>
                {([phase, tasks]) => (
                  <div class="mb-4 last:mb-0">
                    <div class="text-[10px] font-mono uppercase tracking-wider text-gray-600 border-b border-gray-800/60 pb-1 mb-2">
                      {phase}
                    </div>
                    <TaskGrid tasks={tasks} />
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </article>
  );
}

function TaskGrid(props: { tasks: ServerTask[] }) {
  return (
    <ul class="grid gap-x-6 gap-y-3 grid-cols-1 min-[720px]:grid-cols-2 min-[1280px]:grid-cols-3">
      <For each={props.tasks}>
        {(t, i) => (
          <li class="relative">
            <TaskCard task={t} />
            <Show when={i() < props.tasks.length - 1}>
              <ReadingOrderArrow />
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}

function ReadingOrderArrow() {
  return (
    <span
      aria-hidden="true"
      class="
        pointer-events-none absolute text-gray-700 text-xs select-none
        right-[-18px] top-1/2 -translate-y-1/2
        max-[719px]:left-1/2 max-[719px]:-translate-x-1/2 max-[719px]:right-auto
        max-[719px]:top-auto max-[719px]:bottom-[-14px] max-[719px]:translate-y-0
        max-[719px]:rotate-90
        border-dashed
      "
    >
      →
    </span>
  );
}

function StatusBadge(props: { status: string }) {
  const cls = () => {
    switch (props.status) {
      case 'active': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'next': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'blocked': return 'bg-red-500/15 text-red-300 border-red-500/30';
      case 'done': return 'bg-emerald-500/30 text-emerald-200 border-emerald-500/40';
      default: return 'bg-gray-800/60 text-gray-400 border-gray-700';
    }
  };
  return (
    <span class={`px-2 py-0.5 rounded-md border text-[10px] font-mono uppercase tracking-wider flex-shrink-0 ${cls()}`}>
      {props.status}
    </span>
  );
}

function NoTasks() {
  return (
    <p class="text-xs text-gray-600 italic py-2">No tasks linked to this initiative yet.</p>
  );
}
