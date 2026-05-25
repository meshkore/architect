/**
 * StoryBanner — sticky banner shown below the tab bar while a story
 * run is active.
 *
 * Surfaces the four reporting requirements operator decision
 * 2026-05-25:
 *  - currently executing task (id + title, with animated dot),
 *  - N/total tasks (counts TASKS, never claude-code tool-use steps),
 *  - mm:ss elapsed on the current task (ticks every second),
 *  - Cancel button (POST /chat/cancel + clear local state).
 *
 * The V80 monolith showed an inflated step counter from claude-code;
 * we deliberately do NOT surface that here. The only counter is the
 * task counter.
 */

import { Show } from 'solid-js';
import { storyStore } from '~/state/story';
import { allTasks } from '~/state/server';
import { daemonStore } from '~/state/daemon';
import { log } from '~/lib/log';

function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss < 10 ? '0' : ''}${ss}`;
}

export default function StoryBanner() {
  const r = () => storyStore.state.run;
  const visible = () => {
    const run = r();
    return !!run && run.status !== 'done';
  };

  const currentId = () => storyStore.currentTaskId();
  const taskTitle = () => {
    const id = currentId();
    if (!id) return '';
    const t = allTasks().find((x) => x.id === id);
    return t?.title ?? id;
  };

  const onCancel = async (): Promise<void> => {
    const run = r();
    if (!run) return;
    storyStore.setStatus('stopping');
    const client = daemonStore.state.client;
    if (client) {
      const res = await client.chatCancel(run.conv);
      if (!res.ok) log.warn('story cancel /chat/cancel failed', res.status, res.body);
    }
    storyStore.clear();
  };

  return (
    <Show when={visible()}>
      <div class="border-b border-emerald-500/30 bg-emerald-500/5 backdrop-blur sticky top-0 z-30">
        <div class="max-w-[1600px] mx-auto px-5 py-2 flex items-center gap-3 flex-wrap">
          <span
            class={`inline-block w-2 h-2 rounded-full ${
              r()!.status === 'running' ? 'bg-emerald-400 animate-pulse' :
              r()!.status === 'paused' ? 'bg-amber-400' :
              r()!.status === 'stopping' ? 'bg-red-400 animate-pulse' :
              'bg-gray-400'
            }`}
            aria-hidden="true"
          />
          <span class="font-mono text-[11px] text-emerald-300 uppercase tracking-wider">
            {r()!.status === 'running' ? '▶ running' : r()!.status}
          </span>
          <Show when={currentId()}>
            <span class="text-xs text-gray-300 truncate flex-1 min-w-0">
              <span class="font-mono text-emerald-400">{currentId()}</span>
              <span class="text-gray-500"> · </span>
              <span class="text-gray-200">{taskTitle()}</span>
            </span>
          </Show>
          <Show when={!currentId()}>
            <span class="text-xs text-gray-400 flex-1">
              {r()!.initiativeTitle}
            </span>
          </Show>
          <span class="font-mono text-[11px] text-gray-300 whitespace-nowrap">
            {Math.min(r()!.cursor + 1, r()!.taskIds.length)} / {r()!.taskIds.length}
          </span>
          <Show when={r()!.status === 'running' && currentId()}>
            <span class="font-mono text-[11px] text-gray-500 whitespace-nowrap tabular-nums">
              {fmtElapsed(storyStore.elapsedTaskMs())}
            </span>
          </Show>
          <button
            type="button"
            onClick={() => void onCancel()}
            disabled={r()!.status === 'stopping'}
            class="px-3 py-1 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 text-[11px] font-semibold disabled:opacity-60 transition-colors"
          >
            {r()!.status === 'stopping' ? 'stopping…' : 'Stop'}
          </button>
        </div>
      </div>
    </Show>
  );
}
