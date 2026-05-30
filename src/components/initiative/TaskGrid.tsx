import { For } from 'solid-js';
import type { ServerTask } from '~/state/server';
import TaskCard from '~/components/TaskCard';

/**
 * TaskGrid — V107.7.
 *
 * Vertical list, one task per line. Replaces the V86h responsive
 * grid (1 / 2 / 3 cols depending on viewport) which forced operators
 * to read titles truncated mid-sentence on narrow columns. With a
 * single column the full title always fits and descriptions expand
 * naturally below.
 *
 * Divider lines between tasks read as visual structure without the
 * boxes that wrapped each task in V86h.
 */
export function TaskGrid(props: { tasks: ServerTask[] }) {
  return (
    <ul class="flex flex-col divide-y divide-gray-800/40">
      <For each={props.tasks}>
        {(t) => (
          <li class="min-w-0">
            <TaskCard task={t} />
          </li>
        )}
      </For>
    </ul>
  );
}

export function StatusBadge(props: { status: string }) {
  const cls = () => {
    switch (props.status) {
      case 'active': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'next': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'blocked': return 'bg-red-500/15 text-red-300 border-red-500/30';
      case 'done': return 'bg-emerald-500/30 text-emerald-200 border-emerald-500/40';
      // V106.4 — daemon py-1.10.7 introduces `pending-operator` for
      // tasks the architect prepared code-side but that need an
      // operator hands-on-keyboard action (paste creds, fund wallet,
      // run wrangler deploy). Visually amber-orange — distinct from
      // `blocked` (red) which means "something broke", and from
      // `next` (plain amber) which means "queued for an agent".
      case 'pending-operator':
      case 'pending_operator':
        return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
      default: return 'bg-gray-800/60 text-gray-400 border-gray-700';
    }
  };
  const label = () => {
    if (props.status === 'pending-operator' || props.status === 'pending_operator') {
      return 'pending op';
    }
    return props.status;
  };
  return (
    <span class={`px-2 py-0.5 rounded-md border text-[10px] font-mono uppercase tracking-wider flex-shrink-0 ${cls()}`}>
      {label()}
    </span>
  );
}
