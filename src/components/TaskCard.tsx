/**
 * TaskCard — V86h.
 *
 * Click the card to expand it inline: title + status stay on top, the
 * task body opens below in a readable column. Click again to collapse.
 * Expansion state is persisted per-task in viewStore (survives reload
 * and project hot-swap, scoped to the active cluster's local storage).
 *
 * When expanded, the card uses `grid-column: 1 / -1` to span the full
 * row width of the TaskGrid — neighbours stay at their compact height,
 * the expanded card grows downward. Lets the operator read an entire
 * initiative without leaving the Roadmap tab.
 */

import { Show } from 'solid-js';
import type { ServerTask } from '~/state/server';
import { viewStore } from '~/state/view';

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
  const expanded = () => viewStore.isTaskExpanded(props.task.id);
  const toggle = (e: MouseEvent): void => {
    // Don't trigger expand when clicking the inline links the body
    // markup might render (a normal anchor inside the body). Cheap
    // check: anchor or button inside the card.
    const t = e.target as HTMLElement | null;
    if (t && t.closest('a, button')) return;
    viewStore.toggleTask(props.task.id);
  };
  const hasBody = (): boolean => {
    const b = props.task.body;
    return typeof b === 'string' && b.trim().length > 0;
  };

  return (
    <div
      data-task-id={props.task.id}
      data-status={props.task.status}
      data-expanded={expanded() ? 'true' : 'false'}
      onClick={toggle}
      class={
        'task-card flex flex-col gap-2 rounded-md bg-gray-900/60 border border-gray-800/70 ' +
        'hover:border-gray-700 cursor-pointer transition-colors min-w-0 ' +
        (expanded() ? 'px-4 py-3 border-emerald-600/40 bg-gray-900/80' : 'px-3 py-2')
      }
    >
      <div class="flex items-center gap-2.5 min-w-0">
        <span
          aria-label={props.task.status}
          title={props.task.status}
          class={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass(props.task.status)} ${
            props.task.status === 'done' ? '' : 'ring-1 ring-inset ring-black/30'
          }`}
        />
        <span class="font-mono text-[10px] text-emerald-300/90 flex-shrink-0">{props.task.id}</span>
        <span
          class={`text-xs text-gray-200 min-w-0 ${expanded() ? '' : 'truncate'}`}
          title={props.task.title}
        >
          {expanded() ? props.task.title : truncate(props.task.title, MAX_TITLE)}
        </span>
        <Show when={props.task.priority === 'high'}>
          <span class="ml-auto font-mono text-[9px] text-amber-400/80 flex-shrink-0 uppercase">!</span>
        </Show>
      </div>

      <Show when={expanded()}>
        <div class="pt-2 border-t border-gray-800/60">
          <Show
            when={hasBody()}
            fallback={
              <p class="text-[11px] italic text-gray-600">
                No description yet — open the task in the Tasks tab to add one.
              </p>
            }
          >
            <p class="text-[12px] text-gray-300 leading-relaxed whitespace-pre-wrap">
              {String(props.task.body ?? '').trim()}
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
