/**
 * TaskCard — a single tile in the expanded initiative grid.
 *
 * Per M4.2 spec, the card carries ONLY: status dot, task id, title.
 * No module/category badge (it's redundant inside an initiative's
 * card; multi-module initiatives surface the count in the header).
 */

import { Show } from 'solid-js';
import type { ServerTask } from '~/state/server';

const MAX_TITLE = 60;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function dotClass(status: string): string {
  switch (status) {
    case 'active': return 'bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.7)]';
    case 'next': return 'bg-amber-400';
    case 'done': return 'bg-emerald-500';
    case 'blocked': return 'bg-red-500';
    default: return 'bg-gray-600';
  }
}

export default function TaskCard(props: { task: ServerTask }) {
  return (
    <div
      data-task-id={props.task.id}
      data-status={props.task.status}
      class="flex items-center gap-2.5 px-3 py-2 rounded-md bg-gray-900/60 border border-gray-800/70 hover:border-gray-700 transition-colors min-w-0"
    >
      <span
        aria-label={props.task.status}
        title={props.task.status}
        class={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass(props.task.status)} ${
          props.task.status === 'done' ? '' : 'ring-1 ring-inset ring-black/30'
        }`}
      />
      <span class="font-mono text-[10px] text-emerald-300/90 flex-shrink-0">{props.task.id}</span>
      <span class="text-xs text-gray-200 truncate min-w-0" title={props.task.title}>
        {truncate(props.task.title, MAX_TITLE)}
      </span>
      <Show when={props.task.priority === 'high'}>
        <span class="ml-auto font-mono text-[9px] text-amber-400/80 flex-shrink-0 uppercase">!</span>
      </Show>
    </div>
  );
}
