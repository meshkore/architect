/**
 * StoryRunner — V89. Invisible controller that drives the active
 * story run forward.
 *
 * State now lives daemon-side (py-1.10.0 RunStore + /runs endpoints).
 * The runner's job is the same as before — dispatch the next step
 * when the current task flips done, or after a grace window if the
 * agent posted its final but the file watcher hasn't caught up — but
 * every mutation round-trips through the daemon so the persisted
 * cursor + status are always ground truth.
 *
 * Loop:
 *  - task.updated (status=done for current task)
 *    → POST /runs/<id>/advance → cursor++ → dispatch next.
 *  - chat.assistant.final matching the run's lastStream
 *    → grace timer; if no task.updated within ~3 s, advance optimistically.
 *  - chat.cancelled OR run.cancelled WS event for our run → stop loop.
 */

import { onMount, onCleanup, createEffect } from 'solid-js';
import { storyStore, type StoryRun } from '~/state/story';
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

  /** Dispatch the next step. Caller has already ensured the run is
   *  active and not paused. Returns the stream_id if dispatch went
   *  through, or null on failure. */
  const dispatchCurrent = async (run: StoryRun): Promise<string | null> => {
    const client = daemonStore.state.client;
    if (!client) return null;
    const taskId = run.taskIds[run.cursor];
    if (!taskId) {
      await storyStore.finish(client, run.id, 'done');
      return null;
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
      // Surface as failure on daemon so the panel shows it; cockpit
      // doesn't have to track failure state locally.
      await storyStore.finish(client, run.id, 'failed', `dispatch ${res.status}`);
      return null;
    }
    await storyStore.setStream(client, run.id, res.data.stream_id);
    return res.data.stream_id;
  };

  // Watch for task-status flips → advance the cursor when the current task hits done.
  let lastSeenTaskId: string | null = null;
  createEffect(() => {
    const tasks = allTasks();
    const run = storyStore.state.run;
    if (!run) return;
    // Only act on LIVE runs (status==='running' && live===true). A
    // paused run waits for the operator's explicit ▶ Resume.
    if (run.status !== 'running' || !run.live) return;
    const taskId = run.taskIds[run.cursor];
    if (!taskId) return;
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.status === 'done' && lastSeenTaskId !== taskId) {
      lastSeenTaskId = taskId;
      log.info('story: task done, advancing', taskId);
      clearGrace();
      const client = daemonStore.state.client;
      if (!client) return;
      void (async () => {
        await storyStore.advance(client, run.id, run.cursor + 1);
        const next = storyStore.runForInitiative(run.initiativeId);
        if (next && next.status === 'running' && next.cursor < next.taskIds.length) {
          await dispatchCurrent(next);
        }
      })();
    }
  });

  // Auto-dispatch when a fresh run is born (cursor=0, no stream yet,
  // live false). The daemon broadcast `run.started` triggers this.
  let startedRunId: string | null = null;
  createEffect(() => {
    const run = storyStore.state.run;
    if (!run) return;
    if (run.id === startedRunId) return;
    if (run.status !== 'running') return;
    if (run.lastStream !== null) return; // already dispatched at least once
    startedRunId = run.id;
    void dispatchCurrent(run);
  });

  // Wire the WS hub for finals + cancellations.
  onMount(() => {
    const ws = daemonStore.state.ws;
    if (!ws) return;
    const offFinal = ws.on('chat.assistant.final', (ev) => {
      const run = storyStore.state.run;
      if (!run || run.status !== 'running' || !run.live) return;
      if (typeof ev.conv !== 'string' || ev.conv !== run.conv) return;
      const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : null;
      if (run.lastStream && streamId !== run.lastStream) return;
      clearGrace();
      graceTimer = setTimeout(() => {
        const r2 = storyStore.state.run;
        if (!r2 || r2.status !== 'running') return;
        log.info('story: grace expired, advancing optimistically');
        const c = daemonStore.state.client;
        const id = daemonStore.state.activeId;
        if (c && id) void serverStore.refreshNow(c, id);
        if (c) {
          void (async () => {
            await storyStore.advance(c, r2.id, r2.cursor + 1);
            const next = storyStore.runForInitiative(r2.initiativeId);
            if (next && next.status === 'running' && next.cursor < next.taskIds.length) {
              await dispatchCurrent(next);
            }
          })();
        }
      }, ADVANCE_GRACE_MS);
    });
    onCleanup(() => {
      offFinal();
      clearGrace();
    });
  });

  return null;
}

// Helper exported so InitiativeCard's RUN button can kick a run.
export function collectStoryTaskIds(initiativeId: string): string[] {
  const tasks = allTasks().filter((t) => t.initiative === initiativeId);
  const bucket = { active: [] as string[], next: [] as string[], planned: [] as string[] };
  for (const t of tasks) {
    // V106.4 — pending-operator tasks are intentionally NOT dispatched.
    // The architect (py-1.10.7) marks them when code-side prep is done
    // and only an operator action remains (fund wallet, paste creds,
    // run wrangler deploy). Re-dispatching them would just produce the
    // same blocked turn. The operator clears them by doing the action
    // and flipping the status manually (or the next pass picks them up
    // once the missing piece lands).
    if (t.status === 'done' || t.status === 'cancelled') continue;
    if (t.status === 'pending-operator' || t.status === 'pending_operator') continue;
    if (t.status === 'active' || t.status === 'in_progress') bucket.active.push(t.id);
    else if (t.status === 'next') bucket.next.push(t.id);
    else bucket.planned.push(t.id);
  }
  return [...bucket.active, ...bucket.next, ...bucket.planned];
}
