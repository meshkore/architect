import { For, Show } from 'solid-js';
import type { ServerTask } from '~/state/server';
import TaskCard from '~/components/TaskCard';

export function TaskGrid(props: { tasks: ServerTask[] }) {
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

export function StatusBadge(props: { status: string }) {
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
