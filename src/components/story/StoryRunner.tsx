/**
 * StoryRunner — invisible controller. Mount it once in App so a story
 * run can advance from anywhere: it watches WS events + serverStore
 * task transitions and dispatches the next task automatically.
 *
 * Why a component (instead of a plain helper): so the WS listener is
 * registered + torn down with `onCleanup` (audit §2.3). HMR / route
 * changes do not leak listeners.
 *
 * Loop:
 *  - `task.updated` event with status=done for the current task
 *    → advance + dispatch next.
 *  - `chat.assistant.final` matching the run's lastStream
 *    → grace timer; if still no task.updated within ~3 s, advance
 *    optimistically (the agent likely marked it done but the file
 *    watcher hasn't fired yet).
 *  - `chat.cancelled` for the run's conv → clear the run.
 *
 * V80 parity: matches `dispatchNextStoryTask` / `_finishStoryRun`
 * semantics, minus the inflated step counter (M4.5 fix).
 */

import { onMount, onCleanup, createEffect } from 'solid-js';
import { storyStore } from '~/state/story';
import { daemonStore } from '~/state/daemon';
import { serverStore, allTasks } from '~/state/server';
import { log } from '~/lib/log';

const ADVANCE_GRACE_MS = 3000;

function buildPrompt(taskId: string, initiativeTitle: string, cursor: number, total: number): string {
  const t = allTasks().find((x) => x.id === taskId);
  const stepLabel = `${cursor + 1}/${total}`;
  if (!t) {
    return [
      `[story-run · step ${stepLabel}]`,
      ``,
      `Work on task \`${taskId}\` from initiative "${initiativeTitle}".`,
      `Open the task file under .meshkore/modules/<module>/tasks/${taskId}*.md, do the work,`,
      `mark it status: done, append a 1-line summary to the daily log, post a 1-sentence`,
      `summary here, then STOP and wait for the next instruction.`,
    ].join('\n');
  }
  const titleLine = t.title ? ` — ${t.title}` : '';
  const cat = t.category ? ` (module: ${t.category})` : '';
  return [
    `[story-run · step ${stepLabel} of "${initiativeTitle}"]`,
    ``,
    `Work on task \`${t.id}\`${titleLine}${cat}.`,
    ``,
    `Steps:`,
    `1. Open the task file under \`.meshkore/modules/${t.category ?? '<module>'}/tasks/\` and read its body.`,
    `2. Do the work described under "Done when" / the task body. Edit files as needed.`,
    `3. Mark the task \`status: done\` in its frontmatter.`,
    `4. Post a 1-sentence summary of what you did here in chat.`,
    `5. STOP and wait — the story runner will dispatch the next task automatically.`,
    ``,
    `Do NOT continue to other tasks on your own. One task per turn.`,
  ].join('\n');
}

export default function StoryRunner() {
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  const clearGrace = (): void => {
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  };

  const dispatchCurrent = async (): Promise<void> => {
    const run = storyStore.state.run;
    if (!run || run.status !== 'running') return;
    const taskId = run.taskIds[run.cursor];
    if (!taskId) {
      storyStore.setStatus('done');
      return;
    }
    const client = daemonStore.state.client;
    if (!client) {
      storyStore.recordFailure(taskId, 'no daemon client');
      return;
    }
    const prompt = buildPrompt(taskId, run.initiativeTitle, run.cursor, run.taskIds.length);
    const res = await client.chatDispatch({
      conv: run.conv,
      author: 'architect',
      text: prompt,
      initiative_id: run.initiativeId,
      task_id: taskId,
    });
    if (!res.ok) {
      log.warn('story dispatch failed', res.status, res.body);
      storyStore.recordFailure(taskId, `dispatch ${res.status}`);
      return;
    }
    storyStore.setStream(res.data.stream_id);
  };

  // Watch for task-status flips → advance the cursor when the current task hits done.
  let lastSeenTaskId: string | null = null;
  createEffect(() => {
    const tasks = allTasks();
    const run = storyStore.state.run;
    if (!run || run.status !== 'running') return;
    const taskId = run.taskIds[run.cursor];
    if (!taskId) return;
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.status === 'done' && lastSeenTaskId !== taskId) {
      lastSeenTaskId = taskId;
      log.info('story: task done, advancing', taskId);
      clearGrace();
      storyStore.advance();
      // Kick the next task.
      void dispatchCurrent();
    }
  });

  // Wire the WS hub for finals + cancellations.
  onMount(() => {
    const ws = daemonStore.state.ws;
    if (!ws) return;
    const offFinal = ws.on('chat.assistant.final', (ev) => {
      const run = storyStore.state.run;
      if (!run || run.status !== 'running') return;
      if (typeof ev.conv !== 'string' || ev.conv !== run.conv) return;
      const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : null;
      if (run.lastStream && streamId !== run.lastStream) return;
      // Final arrived. Give the file watcher a grace window to flip
      // the task to done. If it doesn't, advance optimistically.
      clearGrace();
      graceTimer = setTimeout(() => {
        const r2 = storyStore.state.run;
        if (!r2 || r2.status !== 'running') return;
        log.info('story: grace expired, advancing optimistically');
        storyStore.advance();
        const c = daemonStore.state.client;
        const id = daemonStore.state.activeId;
        if (c && id) void serverStore.refreshNow(c, id);
        void dispatchCurrent();
      }, ADVANCE_GRACE_MS);
    });
    const offCancel = ws.on('chat.cancelled', (ev) => {
      const run = storyStore.state.run;
      if (!run) return;
      if (typeof ev.conv !== 'string' || ev.conv !== run.conv) return;
      log.info('story: cancelled by daemon');
      clearGrace();
      storyStore.clear();
    });
    onCleanup(() => {
      offFinal();
      offCancel();
      clearGrace();
    });
  });

  // Auto-dispatch when a fresh run is started (cursor=0, no stream yet).
  let startedRunId: string | null = null;
  createEffect(() => {
    const run = storyStore.state.run;
    if (!run || run.status !== 'running') return;
    if (run.id === startedRunId) return;
    startedRunId = run.id;
    void dispatchCurrent();
  });

  return null;
}

// Helper exported so InitiativeCard's RUN button can kick a run.
export function collectStoryTaskIds(initiativeId: string): string[] {
  const tasks = allTasks().filter((t) => t.initiative === initiativeId);
  const bucket = { active: [] as string[], next: [] as string[], planned: [] as string[] };
  for (const t of tasks) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    if (t.status === 'active' || t.status === 'in_progress') bucket.active.push(t.id);
    else if (t.status === 'next') bucket.next.push(t.id);
    else bucket.planned.push(t.id);
  }
  return [...bucket.active, ...bucket.next, ...bucket.planned];
}
