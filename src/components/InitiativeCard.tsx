import { For, Show, createSignal, createMemo } from 'solid-js';
import type { ServerInitiative, ServerTask } from '~/state/server';
import { sortTasks, groupByPhases } from '~/components/initiative/task-grouping';
import { TaskGrid, StatusBadge } from '~/components/initiative/TaskGrid';
import { storyStore } from '~/state/story';
import { chatStore } from '~/state/chat';
import { nav } from '~/state/nav';
import { collectStoryTaskIds } from '~/components/story/StoryRunner';
import StoryProgressPill from '~/components/story/StoryProgressPill';
import { log } from '~/lib/log';

export default function InitiativeCard(props: { initiative: ServerInitiative; tasks: ServerTask[] }) {
  const [expanded, setExpanded] = createSignal(true);
  const [groupByPhase, setGroupByPhase] = createSignal(false);

  const sorted = createMemo(() => sortTasks(props.tasks));
  const done = createMemo(() => props.tasks.filter((t) => t.status === 'done').length);

  const modules = createMemo<string[]>(() => {
    const m = new Set<string>();
    for (const t of props.tasks) {
      if (t.module) m.add(t.module);
      else if (t.category) m.add(t.category);
    }
    return [...m];
  });

  const grouped = createMemo<[string, ServerTask[]][]>(() => groupByPhases(sorted()));

  const startRun = (): void => {
    const taskIds = collectStoryTaskIds(props.initiative.id);
    if (taskIds.length === 0) {
      log.warn('initiative has no open tasks to run', props.initiative.id);
      return;
    }
    const existing = storyStore.state.run;
    if (existing && existing.status !== 'done') {
      log.warn('story already running — stop it first', existing.initiativeId);
      return;
    }
    const conv = chatStore.state.activeConv ?? `story-${props.initiative.id}-${Date.now().toString(36)}`;
    chatStore.setActiveConv(conv);
    storyStore.start({
      id: `${props.initiative.id}-${Date.now().toString(36)}`,
      initiativeId: props.initiative.id,
      initiativeTitle: props.initiative.title,
      conv,
      taskIds,
    });
    nav.setCockpitTab('chat');
  };

  const isRunning = () => storyStore.state.run?.initiativeId === props.initiative.id
    && storyStore.state.run?.status !== 'done';

  return (
    <article class="bg-gray-900/40 border border-gray-800/70 rounded-lg overflow-hidden">
      <header class="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={startRun}
          disabled={isRunning()}
          title={isRunning() ? 'Story running — use the banner to Stop' : 'Run initiative'}
          class="w-7 h-7 rounded-md bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 flex items-center justify-center text-xs flex-shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => setExpanded(!expanded())}
          class="flex-1 flex items-center gap-3 min-w-0 text-left"
        >
          <h3 class="text-sm font-semibold text-gray-100 truncate">{props.initiative.title}</h3>
          <Show when={props.initiative.status}>
            <StatusBadge status={props.initiative.status as string} />
          </Show>
          <Show when={modules().length > 1}>
            <span class="font-mono text-[10px] text-gray-500 uppercase tracking-wider flex-shrink-0">
              {modules().length} modules
            </span>
          </Show>
          <span class="ml-auto flex-shrink-0">
            <StoryProgressPill
              initiativeId={props.initiative.id}
              totalTasks={props.tasks.length}
              doneTasks={done()}
            />
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            class={`text-gray-600 flex-shrink-0 transition-transform ${expanded() ? 'rotate-180' : ''}`}>
            <path d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </header>

      <Show when={expanded()}>
        <div class="border-t border-gray-800/60 px-4 py-3">
          <Show when={props.tasks.length > 0} fallback={<NoTasks />}>
            <div class="flex items-center justify-end mb-3">
              <label class="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={groupByPhase()}
                  onChange={(e) => setGroupByPhase((e.currentTarget as HTMLInputElement).checked)}
                  class="accent-emerald-500"
                />
                Group by phase
              </label>
            </div>
            <Show when={groupByPhase()} fallback={<TaskGrid tasks={sorted()} />}>
              <For each={grouped()}>
                {([phase, tasks]) => (
                  <div class="mb-4 last:mb-0">
                    <div class="text-[10px] font-mono uppercase tracking-wider text-gray-600 border-b border-gray-800/60 pb-1 mb-2">
                      {phase}
                    </div>
                    <TaskGrid tasks={tasks} />
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </article>
  );
}

function NoTasks() {
  return (
    <p class="text-xs text-gray-600 italic py-2">No tasks linked to this initiative yet.</p>
  );
}
