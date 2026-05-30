import { For, Show } from 'solid-js';
import type { ServerTask } from '~/state/server';
import TaskCard from '~/components/TaskCard';
import { viewStore } from '~/state/view';

export function TaskGrid(props: { tasks: ServerTask[] }) {
  return (
    <ul class="grid gap-x-6 gap-y-3 grid-cols-1 min-[720px]:grid-cols-2 min-[1280px]:grid-cols-3">
      <For each={props.tasks}>
        {(t, i) => {
          // V86h — the reading-order arrow only makes sense between
          // collapsed siblings in the grid. When a task expands to
          // span the full row it visually breaks the left-to-right
          // reading chain anyway, so hide the arrow for that row.
          // We also lift `col-span-full` onto the <li> (grid item)
          // — putting it on TaskCard didn't take because the <li> is
          // what the grid lays out.
          const expanded = () => viewStore.isTaskExpanded(t.id);
          return (
            <li
              class="relative"
              classList={{ 'min-[720px]:col-span-full': expanded() }}
            >
              <TaskCard task={t} />
              <Show when={i() < props.tasks.length - 1 && !expanded()}>
                <ReadingOrderArrow />
              </Show>
            </li>
          );
        }}
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
