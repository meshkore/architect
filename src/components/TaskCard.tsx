/**
 * TaskCard — V107.7.
 *
 * Borderless inline row. No boxed card, no status dot — the status
 * lives on the code chip ("DEMO3") which carries the colour. Title
 * to the right of the chip; description below (preview of the first
 * ~3 lines, with "+ more" / "— less" to toggle the full body).
 *
 * Status colour on the chip:
 *   - done                 → solid emerald
 *   - active / in_progress → amber, pulsing (real-time signal that
 *                             work is happening RIGHT NOW)
 *   - next                 → amber dim
 *   - blocked              → red
 *   - pending-operator     → orange
 *   - default (planned)    → slate gray
 *
 * V107.7 replaces the V86h click-to-expand boxed card. Operator wanted
 * one task per line, no surrounding rectangle, code-chip-as-status
 * indicator, and the description naturally below the title.
 */

import { Show, createMemo, createSignal } from 'solid-js';
import type { ServerTask } from '~/state/server';
import { activeTaskIds } from '~/state/server';

const PREVIEW_LINES = 3;
const PREVIEW_CHARS = 220;

function codeChipClass(status: string): string {
  switch (status) {
    case 'done':
      return 'bg-emerald-500/25 text-emerald-100 border-emerald-500/50';
    case 'active':
    case 'in_progress':
      return 'bg-amber-500/30 text-amber-100 border-amber-400/70 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.35)]';
    case 'next':
      return 'bg-amber-500/12 text-amber-300 border-amber-500/35';
    case 'blocked':
      return 'bg-red-500/20 text-red-200 border-red-500/55';
    case 'pending-operator':
    case 'pending_operator':
      return 'bg-orange-500/20 text-orange-300 border-orange-500/55';
    case 'cancelled':
      return 'bg-gray-800/60 text-gray-500 border-gray-700/60 line-through decoration-gray-600';
    default:
      return 'bg-gray-800/60 text-gray-400 border-gray-700/70';
  }
}

export default function TaskCard(props: { task: ServerTask }) {
  const [expanded, setExpanded] = createSignal(false);
  const body = createMemo((): string => (props.task.body ?? '').trim());
  const hasBody = (): boolean => body().length > 0;
  const isLong = createMemo((): boolean => {
    const b = body();
    if (b.length > PREVIEW_CHARS) return true;
    const lines = (b.match(/\n/g) ?? []).length + 1;
    return lines > PREVIEW_LINES;
  });
  const preview = createMemo((): string => {
    const b = body();
    if (!isLong()) return b;
    const byLines = b.split('\n').slice(0, PREVIEW_LINES).join('\n');
    if (byLines.length <= PREVIEW_CHARS) return byLines;
    return byLines.slice(0, PREVIEW_CHARS - 1).trimEnd() + '…';
  });

  return (
    <div
      data-task-id={props.task.id}
      data-status={props.task.status}
      class="py-2.5 min-w-0"
    >
      <div class="flex items-baseline gap-3 min-w-0">
        <span
          aria-label={`status ${props.task.status}${activeTaskIds().has(props.task.id) ? ' · agent working live' : ''}`}
          title={
            activeTaskIds().has(props.task.id)
              ? `${props.task.status} · agent working live`
              : props.task.status
          }
          class={`flex-shrink-0 inline-block min-w-[3.5rem] text-center font-mono text-[10px] uppercase tracking-wider px-1.5 py-1 rounded border leading-none ${
            // py-1.11.0 — Live signal wins over the on-disk task status:
            // if any agent is currently dispatched against this task_id
            // (derived from chatStore.state.convs[…].task_id where
            // live=true), force the pulsing amber chip even if the
            // task's frontmatter still says `next`/`planned`.
            activeTaskIds().has(props.task.id)
              ? 'bg-amber-500/30 text-amber-100 border-amber-400/70 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.35)]'
              : codeChipClass(props.task.status)
          }`}
        >
          {props.task.id}
        </span>
        <h4 class="text-[13px] font-medium text-gray-100 leading-snug break-words min-w-0">
          {props.task.title}
        </h4>
        <Show when={props.task.priority === 'high'}>
          <span class="ml-auto font-mono text-[9px] text-amber-400/80 flex-shrink-0 uppercase" title="High priority">!</span>
        </Show>
      </div>

      <Show when={hasBody()}>
        <div class="mt-2 pl-[4.25rem] pr-1">
          <p class="text-[12px] text-gray-400 leading-relaxed whitespace-pre-wrap break-words">
            {expanded() || !isLong() ? body() : preview()}
          </p>
          <Show when={isLong()}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded()); }}
              class="mt-1 text-[10px] font-mono uppercase tracking-wider text-emerald-300/70 hover:text-emerald-300 transition-colors"
            >
              {expanded() ? '— less' : '+ more'}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
