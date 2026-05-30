/**
 * InitiativeCard — V86h.
 *
 * Header shows: run button · TITLE · status · module count · progress
 * pill · expand chevron. The all-caps slug chip (e.g. "DAEMON-RUNTIME")
 * was removed from the header because the title already says it in
 * human form — having both side-by-side felt duplicated. The slug
 * still lives on the expanded card so the operator can copy it for
 * chat references.
 *
 * Expanded body, in order:
 *   1. Description: one-line preview (oneliner) + "more" button that
 *      reveals the long-form `body` (markdown source rendered as
 *      plain text for now). Click "less" to collapse.
 *   2. Tasks: ALWAYS grouped by phase. The "Group by phase" checkbox
 *      was removed — phases are the only sensible ordering for a
 *      foundation → build → docs → ship pipeline. The persisted
 *      `groupByPhase` flag in viewStore is dead code we keep for
 *      backwards-compat with older localStorage payloads.
 */

import { For, Show, createMemo, createResource } from 'solid-js';
import type { ServerInitiative, ServerTask } from '~/state/server';
import { sortTasks, groupByPhases } from '~/components/initiative/task-grouping';
import { TaskGrid, StatusBadge } from '~/components/initiative/TaskGrid';
import { storyStore } from '~/state/story';
import { chatStore } from '~/state/chat';
import { viewStore } from '~/state/view';
import { daemonStore } from '~/state/daemon';
import { collectStoryTaskIds } from '~/components/story/StoryRunner';
import StoryProgressPill from '~/components/story/StoryProgressPill';
import { log } from '~/lib/log';

const DESCRIPTION_PREVIEW_CHARS = 220;

export default function InitiativeCard(props: { initiative: ServerInitiative; tasks: ServerTask[] }) {
  const expanded = () => viewStore.isInitiativeExpanded(props.initiative.id);
  const setExpanded = (v: boolean) => viewStore.setInitiativeExpanded(props.initiative.id, v);
  const descExpanded = () => viewStore.isDescriptionExpanded(props.initiative.id);
  const toggleDesc = () => viewStore.toggleDescription(props.initiative.id);

  const sorted = createMemo(() => sortTasks(props.tasks));
  const done = createMemo(() => props.tasks.filter((t) => t.status === 'done').length);
  // V89.3 — initiative is "complete" when it has at least one task
  // and every task is done. Used to swap the play button for a
  // subtle check mark, and to hide the row from the default
  // visibility=active list (InitiativesPanel filters on this).
  const isComplete = createMemo(() => props.tasks.length > 0 && done() === props.tasks.length);

  const modules = createMemo<string[]>(() => {
    const m = new Set<string>();
    for (const t of props.tasks) {
      if (t.module) m.add(t.module);
      else if (t.category) m.add(t.category);
    }
    return [...m];
  });

  const grouped = createMemo<[string, ServerTask[]][]>(() => groupByPhases(sorted()));

  /** Computed description preview/full state. `oneliner` is always the
   *  short hook; `body` is the long-form. If only one of the two is
   *  present we fall back gracefully. */
  const oneliner = (): string => (props.initiative.oneliner ?? '').trim();
  const body = (): string => (props.initiative.body ?? '').trim();
  const hasDescription = (): boolean => oneliner().length > 0 || body().length > 0;
  const hasMore = (): boolean => {
    const b = body();
    if (!b) return false;
    if (b === oneliner()) return false;
    return b.length > DESCRIPTION_PREVIEW_CHARS || b.includes('\n');
  };

  // V89 — All run state lives daemon-side. Cockpit just reflects.
  const thisRun = () => storyStore.runForInitiative(props.initiative.id);
  const isThisLive = () => {
    const r = thisRun();
    return !!r && r.live && r.status !== 'paused';
  };
  const isThisPaused = () => {
    const r = thisRun();
    return !!r && r.status === 'paused';
  };
  const isOtherLive = () => {
    const r = storyStore.state.run;
    if (!r || !r.live) return false;
    return r.initiativeId !== props.initiative.id;
  };
  // V106 — when a Roadmap Architect (Run all) is active, per-initiative
  // play buttons must be disabled. The architect drives the roadmap as
  // a whole; letting the operator also spawn a per-initiative agent
  // would race two coordinators on the same task graph.
  const architectLive = () => chatStore.findActiveArchitectConv() !== null;

  const startRun = async (): Promise<void> => {
    const taskIds = collectStoryTaskIds(props.initiative.id);
    if (taskIds.length === 0) {
      log.warn('initiative has no open tasks to run', props.initiative.id);
      return;
    }
    const client = daemonStore.state.client;
    if (!client) {
      log.warn('startRun: no daemon client');
      return;
    }
    // Always spawn a fresh agent + conv — isolated cancellation domain.
    const conv = chatStore.createStoryConv({
      initiativeId: props.initiative.id,
      initiativeTitle: props.initiative.title,
    });
    const agentId = chatStore.state.convMeta[conv]?.agentId ?? '?';
    const res = await storyStore.start(client, {
      initiativeId: props.initiative.id,
      initiativeTitle: props.initiative.title,
      conv,
      agentId,
      agentTitle: props.initiative.title,
      taskIds,
    });
    if (!res.ok) log.warn('startRun: daemon create failed', res.status, res.error);
  };

  const stopRun = async (): Promise<void> => {
    const run = thisRun();
    if (!run) return;
    const client = daemonStore.state.client;
    if (!client) return;
    await storyStore.cancel(client, run.id);
  };

  /** V89 — When the run is paused (status='running' server-side but
   *  no live chat session), the play button resumes it: re-dispatch
   *  the current step on the existing conv. Reuses the same prompt
   *  builder StoryRunner uses on auto-advance. */
  const resumeRun = async (): Promise<void> => {
    const run = thisRun();
    if (!run) return;
    const client = daemonStore.state.client;
    if (!client) return;
    const taskId = run.taskIds[run.cursor];
    if (!taskId) {
      // Cursor past the end — finish it.
      await storyStore.finish(client, run.id, 'done');
      return;
    }
    chatStore.setActiveConv(run.conv);
    const prompt = buildResumePrompt(taskId, run.initiativeTitle, run.cursor, run.taskIds.length);
    const res = await client.chatDispatch({
      conv: run.conv,
      author: 'architect',
      text: prompt,
      initiative_id: run.initiativeId,
      task_id: taskId,
    });
    if (!res.ok) {
      log.warn('resumeRun: dispatch failed', res.status, res.body);
      return;
    }
    await storyStore.setStream(client, run.id, res.data.stream_id);
  };

  const toggleRun = (): void => {
    if (isThisLive()) void stopRun();
    else if (isThisPaused()) void resumeRun();
    else void startRun();
  };

  // V86w — archive / unarchive lives in viewStore (per-cluster
  // localStorage). When the operator archives an initiative the
  // panel's `visibility` filter hides it from the active list — the
  // initiative still exists, can be unarchived, and reappears on
  // demand.
  const isArchived = () => viewStore.isInitiativeArchived(props.initiative.id);
  const toggleArchive = (e: MouseEvent): void => {
    e.stopPropagation();
    viewStore.setInitiativeArchived(props.initiative.id, !isArchived());
  };

  // V86w — Detail tab inside the expanded card. Defaults to 'tasks';
  // 'activity' fetches /initiative/<id>/activity (commits + files).
  const tab = () => viewStore.initiativeTab(props.initiative.id);
  const setTab = (t: 'tasks' | 'activity') => viewStore.setInitiativeTab(props.initiative.id, t);

  return (
    <article class={`bg-gray-900/40 border rounded-lg overflow-hidden ${
      isArchived() ? 'border-amber-500/25 opacity-70' : 'border-gray-800/70'
    }`}>
      <header class="flex items-center gap-3 px-4 py-3">
        <Show
          when={!isComplete()}
          fallback={
            <span
              title="Initiative complete — all tasks done"
              aria-label="initiative complete"
              class="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 border border-emerald-500/30 bg-emerald-500/5 text-emerald-300/70"
            >
              {/* V89.3 — Simple "V" / check mark inside the same square
                  shape the play button uses. No circle, no fill — just
                  a subtle stroke so the operator scans "this one's
                  done" at a glance, especially under the ALL filter
                  where complete + pending live side by side. */}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
            </span>
          }
        >
          <button
            type="button"
            onClick={toggleRun}
            disabled={(isOtherLive() || architectLive()) && !isThisLive()}
            title={
              isThisLive() ? 'Stop the run live on this initiative'
              : isThisPaused() ? 'Resume this run (the previous turn was cut by a reload)'
              : architectLive() ? 'Run all está en marcha (Roadmap Architect activo). Páralo desde el botón Run all del header para arrancar iniciativas individuales.'
              : isOtherLive() ? 'Another initiative is running — stop it first'
              : 'Run initiative (spawns a fresh agent)'
            }
            class={`w-7 h-7 rounded-md flex items-center justify-center text-xs flex-shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:grayscale border ${
              isThisLive()
                ? 'bg-red-500/15 hover:bg-red-500/30 text-red-300 border-red-500/40'
                : isThisPaused()
                  ? 'bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
                  : architectLive()
                    ? 'bg-gray-700/30 text-gray-500 border-gray-700/50'
                    : 'bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
            }`}
          >
            {isThisLive() ? '■' : '▶'}
          </button>
        </Show>
        <button
          type="button"
          onClick={() => setExpanded(!expanded())}
          class="flex-1 flex items-center gap-3 min-w-0 text-left"
        >
          <h3 class="text-sm font-semibold text-gray-100 truncate">{props.initiative.title}</h3>
          <Show when={isArchived()}>
            <span class="font-mono text-[9px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 uppercase tracking-wider flex-shrink-0">
              archived
            </span>
          </Show>
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
        <button
          type="button"
          onClick={toggleArchive}
          title={isArchived() ? 'Restore to active list' : 'Hide from active list'}
          class="w-7 h-7 rounded-md text-gray-500 hover:text-amber-300 border border-transparent hover:border-amber-500/40 flex items-center justify-center text-[10px] font-mono flex-shrink-0 transition-colors"
        >
          <Show when={!isArchived()} fallback={<span aria-hidden="true">↺</span>}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8" />
              <path d="M10 12h4" />
            </svg>
          </Show>
        </button>
      </header>

      <Show when={expanded()}>
        <div class="border-t border-gray-800/60 px-4 py-3 space-y-4">
          <Show when={hasDescription()}>
            <Description
              oneliner={oneliner()}
              body={body()}
              expanded={descExpanded()}
              toggleable={hasMore()}
              onToggle={toggleDesc}
              slug={props.initiative.id}
            />
          </Show>

          {/* V86w — detail tabs. `tasks` keeps the existing per-phase
              grid; `activity` surfaces git commits + files modified
              for this initiative (daemon py-1.9.3+). */}
          <div class="flex items-center gap-1 border-b border-gray-800/60 -mx-4 px-4 pb-1">
            <TabPill label="Tasks" active={tab() === 'tasks'} onClick={() => setTab('tasks')} />
            <TabPill label="Activity" active={tab() === 'activity'} onClick={() => setTab('activity')} />
          </div>

          <Show when={tab() === 'activity'} fallback={
            <Show when={props.tasks.length > 0} fallback={<NoTasks />}>
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
          }>
            <ActivityTab initiativeId={props.initiative.id} />
          </Show>
        </div>
      </Show>
    </article>
  );
}

function Description(props: {
  oneliner: string;
  body: string;
  expanded: boolean;
  toggleable: boolean;
  onToggle: () => void;
  slug: string;
}) {
  // Pick what shows in the collapsed preview:
  //   - oneliner if present (one-sentence hook the author wrote)
  //   - else the first DESCRIPTION_PREVIEW_CHARS of body
  const preview = (): string => {
    if (props.oneliner) return props.oneliner;
    if (props.body.length <= DESCRIPTION_PREVIEW_CHARS) return props.body;
    return props.body.slice(0, DESCRIPTION_PREVIEW_CHARS).trimEnd() + '…';
  };
  return (
    <div class="rounded-md bg-gray-900/40 border border-gray-800/50 px-3 py-2.5">
      <div class="flex items-center gap-2 mb-1.5">
        <span
          class="font-mono text-[9px] text-emerald-300/80 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 uppercase tracking-wider"
          title="Initiative ID — reference this in chat"
        >
          {props.slug}
        </span>
        <span class="text-[10px] font-mono uppercase tracking-wider text-gray-600">description</span>
      </div>
      <Show
        when={props.expanded && props.body}
        fallback={
          <p class="text-[13px] text-gray-300 leading-relaxed whitespace-pre-wrap">{preview()}</p>
        }
      >
        <p class="text-[13px] text-gray-300 leading-relaxed whitespace-pre-wrap">{props.body}</p>
      </Show>
      <Show when={props.toggleable}>
        <button
          type="button"
          onClick={props.onToggle}
          class="mt-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-300/70 hover:text-emerald-300 transition-colors"
        >
          {props.expanded ? '— less' : '+ more'}
        </button>
      </Show>
    </div>
  );
}

function NoTasks() {
  return (
    <p class="text-xs text-gray-600 italic py-2">No tasks linked to this initiative yet.</p>
  );
}

function TabPill(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`px-2.5 py-1 rounded-t text-[10px] font-mono uppercase tracking-wider transition-colors ${
        props.active
          ? 'text-emerald-300 border-b-2 border-emerald-500'
          : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'
      }`}
    >
      {props.label}
    </button>
  );
}

/**
 * V86w — Activity tab for an expanded initiative card. Fetches
 * `/initiative/<id>/activity` (py-1.9.3+) — git commits whose
 * subject/body mentions the initiative id, with the files each
 * commit touched. Multi-repo workspaces label each commit with its
 * repo slug so the operator can tell them apart.
 *
 * Daemons older than py-1.9.3 don't expose the endpoint; the
 * createResource error surfaces a "needs daemon py-1.9.3" notice
 * with the upgrade hint.
 */
function ActivityTab(props: { initiativeId: string }) {
  const [activity] = createResource(
    () => ({ id: props.initiativeId, client: daemonStore.state.client }),
    async (input) => {
      if (!input.client) throw new Error('no daemon client');
      const r = await input.client.initiativeActivity(input.id);
      if (!r.ok) throw new Error(r.error ?? `HTTP ${r.status}`);
      return r.data;
    },
  );
  const supported = () => (daemonStore.state.health?.features ?? []).includes('initiative.activity');

  return (
    <div class="space-y-2">
      <Show when={!supported()}>
        <div class="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
          Daemon doesn't expose <code class="font-mono">initiative.activity</code> yet — upgrade to <span class="font-mono">py-1.9.3</span> (apply protocol <span class="font-mono">P4</span>).
        </div>
      </Show>
      <Show when={supported() && activity.loading}>
        <p class="text-[11px] text-gray-500 font-mono">scanning git…</p>
      </Show>
      <Show when={supported() && activity.error}>
        <p class="text-[11px] text-red-400 font-mono">load failed — {String(activity.error)}</p>
      </Show>
      <Show when={supported() && activity()?.error}>
        <p class="text-[11px] text-gray-500 italic">{activity()?.error}</p>
      </Show>
      <Show when={supported() && activity() && (activity()!.commits.length === 0) && !activity()!.error}>
        <p class="text-[11px] text-gray-600 italic">
          No commits reference <code class="font-mono text-gray-400">{props.initiativeId}</code> yet. Commit messages that mention the id get picked up automatically.
        </p>
      </Show>
      <Show when={(activity()?.commits.length ?? 0) > 0}>
        <ul class="space-y-2.5">
          <For each={activity()!.commits}>
            {(c) => <CommitRow commit={c} />}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function CommitRow(props: { commit: import('~/lib/daemon-client').InitiativeActivityCommit }) {
  return (
    <li class="rounded border border-gray-800/60 bg-gray-900/40 px-3 py-2">
      <div class="flex items-center gap-2 text-[11px] font-mono mb-1 flex-wrap">
        <span class="text-emerald-300/90">{props.commit.short_sha}</span>
        <Show when={props.commit.repo}>
          <span class="text-gray-600 bg-gray-800/60 border border-gray-700/60 rounded px-1.5 py-0.5 uppercase tracking-wider text-[9px]">
            {props.commit.repo}
          </span>
        </Show>
        <span class="text-gray-500 truncate flex-1 min-w-0" title={props.commit.author}>
          {props.commit.author}
        </span>
        <time class="text-gray-600" dateTime={props.commit.ts}>
          {formatCommitTs(props.commit.ts)}
        </time>
      </div>
      <p class="text-[12px] text-gray-200 leading-snug mb-1.5">{props.commit.subject}</p>
      <Show when={props.commit.files.length > 0}>
        <details class="text-[10px] font-mono text-gray-500">
          <summary class="cursor-pointer hover:text-gray-300">
            {props.commit.files.length} file{props.commit.files.length === 1 ? '' : 's'}
            <Show when={props.commit.files_truncated}>
              <span class="text-amber-400/80"> (truncated)</span>
            </Show>
          </summary>
          <ul class="mt-1 space-y-0.5 max-h-48 overflow-y-auto">
            <For each={props.commit.files}>
              {(f) => <li class="text-gray-400 truncate" title={f}>{f}</li>}
            </For>
          </ul>
        </details>
      </Show>
    </li>
  );
}

/** V89 — Resume prompt used when the operator clicks ▶ on a paused
 *  run (status=running server-side but no live chat session, e.g.
 *  cockpit reloaded mid-run). Same shape as StoryRunner.buildPrompt
 *  with a header that tells the agent the prior turn was cut. */
function buildResumePrompt(taskId: string, initiativeTitle: string, cursor: number, total: number): string {
  const stepLabel = `${cursor + 1}/${total}`;
  return [
    `[story-run · resuming step ${stepLabel} of "${initiativeTitle}"]`,
    ``,
    `The previous turn for this story step was interrupted (cockpit reload`,
    `or daemon restart). Pick the work back up on task \`${taskId}\`:`,
    ``,
    `1. Open the task file under \`.meshkore/modules/<module>/tasks/${taskId}*.md\` and read its body.`,
    `2. Continue the work described under "Done when" / the task body.`,
    `3. Mark the task \`status: done\` in its frontmatter when finished.`,
    `4. Post a 1-sentence summary of what you did here in chat.`,
    `5. STOP and wait — the story runner will dispatch the next task automatically.`,
    ``,
    `If you can detect from the timeline that this step was already finished,`,
    `say so in one line and stop — the runner will advance.`,
  ].join('\n');
}

function formatCommitTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return ts;
  }
}
