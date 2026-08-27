/**
 * The structured events the daemon emits alongside chat text.
 *
 * The chat store carries only `chat.*`; ChatPanel folds the relevant
 * `store.events()` entries into the stream by timestamp and these render
 * them: tool.use / tool.result, and the task lifecycle.
 */

import type { DaemonEvent } from '~/lib/daemon-client';

export function ToolUseBubble(props: { ev: DaemonEvent }) {
  const isResult = props.ev.type === 'tool.result';
  const name = String(props.ev['name'] ?? props.ev['tool'] ?? 'tool');
  const summary = String(props.ev['summary'] ?? props.ev['text'] ?? '').slice(0, 240);
  return (
    <div class="flex flex-col gap-1 items-start">
      <span class="text-[10px] font-mono text-gray-600">
        {isResult ? '↳ ' : '⚙ '}{name}
      </span>
      <div class={`max-w-[90%] rounded-md px-3 py-1.5 text-xs font-mono leading-snug whitespace-pre-wrap border ${
        isResult
          ? 'bg-sky-500/5 text-sky-200/90 border-sky-500/25'
          : 'bg-violet-500/5 text-violet-200/90 border-violet-500/25'
      }`}>
        {summary || (isResult ? '(empty result)' : '(no args)')}
      </div>
    </div>
  );
}

export function TaskLifecycleBubble(props: { ev: DaemonEvent }) {
  const t = String(props.ev.type);
  const id = String(props.ev['id'] ?? props.ev['task'] ?? '');
  const label = t === 'task.created' ? 'created'
    : t === 'task.transition' ? `→ ${String(props.ev['status'] ?? '?')}`
    : t === 'task.cancelled' ? 'cancelled'
    : t.replace('task.', '');
  return (
    <div class="flex items-center gap-2 text-[11px] font-mono text-gray-500 self-center">
      <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/70" />
      <span class="text-amber-300/80">{id || 'task'}</span>
      <span class="text-gray-500">{label}</span>
    </div>
  );
}
