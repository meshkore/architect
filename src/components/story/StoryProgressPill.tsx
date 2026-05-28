/**
 * StoryProgressPill — the small `N / total` pill on an initiative card
 * while a story run is in flight for that initiative.
 *
 * Replaces the V80 static "0/44" badge that never updated. Reads from
 * `storyStore.state.run` — if the run belongs to a different
 * initiative, this pill renders the static fallback (just the total).
 */

import { Show } from 'solid-js';
import { storyStore } from '~/state/story';
import { chatStore } from '~/state/chat';
import { uiStore } from '~/state/ui';

interface Props {
  initiativeId: string;
  totalTasks: number;
  /** When provided, used as the fallback denominator if no run is active. */
  doneTasks?: number;
}

export default function StoryProgressPill(props: Props) {
  const r = () => storyStore.runForInitiative(props.initiativeId);
  const matchesRun = () => !!r();
  const agentId = () => r()?.agentId ?? null;
  const isPaused = () => r()?.status === 'paused';

  const goToChat = (e: MouseEvent): void => {
    e.stopPropagation();
    const conv = r()?.conv;
    if (!conv) return;
    chatStore.setActiveConv(conv);
    uiStore.setActiveZone('architect');
  };

  return (
    <Show
      when={matchesRun()}
      fallback={
        <span
          class="px-1.5 py-0.5 rounded-md bg-gray-800/70 border border-gray-700/60 font-mono text-[10px] text-gray-400"
          title="Completed tasks / total tasks in this initiative"
        >
          {props.doneTasks ?? 0}/{props.totalTasks}
        </span>
      }
    >
      <span class="inline-flex items-center gap-1.5">
        <Show when={agentId()}>
          <button
            type="button"
            onClick={goToChat}
            class={`font-mono text-[10px] rounded px-1.5 py-0.5 border transition-colors ${
              isPaused()
                ? 'text-amber-300 bg-amber-500/15 border-amber-500/40 hover:bg-amber-500/30'
                : 'text-emerald-300 bg-emerald-500/15 border-emerald-500/40 hover:bg-emerald-500/30'
            }`}
            title={`Story ${isPaused() ? 'paused' : 'running'} on ${agentId()} — click to open chat`}
          >
            {agentId()} →
          </button>
        </Show>
        <span
          class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono text-[10px] border ${
            isPaused()
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
          }`}
          title="Current task / total in this story run"
        >
          <span
            class={`inline-block w-1.5 h-1.5 rounded-full ${
              isPaused() ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
            }`}
            aria-hidden="true"
          />
          {Math.min(r()!.cursor + 1, r()!.taskIds.length)}/{r()!.taskIds.length}
        </span>
      </span>
    </Show>
  );
}
