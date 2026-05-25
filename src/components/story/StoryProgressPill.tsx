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

interface Props {
  initiativeId: string;
  totalTasks: number;
  /** When provided, used as the fallback denominator if no run is active. */
  doneTasks?: number;
}

export default function StoryProgressPill(props: Props) {
  const r = () => storyStore.state.run;
  const matchesRun = () => r()?.initiativeId === props.initiativeId;

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
      <span
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 font-mono text-[10px] text-emerald-300"
        title="Current task / total in this story run"
      >
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
        {Math.min(r()!.cursor + 1, r()!.taskIds.length)}/{r()!.taskIds.length}
      </span>
    </Show>
  );
}
