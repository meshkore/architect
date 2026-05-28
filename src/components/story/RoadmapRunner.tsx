/**
 * RoadmapRunner — V90, invisible orchestrator for the "Run all"
 * roadmap pass.
 *
 * Watches `roadmapRunStore.state.run`; when status is 'running' and
 * the current initiative has no in-flight daemon run, dispatches it
 * via `storyStore.start(...)` on a fresh agent (one per initiative).
 * When the run for the current cursor lands in {done, cancelled,
 * failed}, advances + kicks the next one.
 *
 * The roadmap pass is sequential by design today; the operator's
 * future ask ("coordinator launches sub-agents in parallel") lives
 * in the agent-run-coordinator initiative.
 *
 * Mount this once in App alongside StoryRunner. It returns null —
 * the side-effect is the dispatch loop.
 */

import { createEffect, onCleanup, onMount } from 'solid-js';
import { roadmapRunStore } from '~/state/roadmap-run';
import { storyStore } from '~/state/story';
import { daemonStore } from '~/state/daemon';
import { chatStore } from '~/state/chat';
import { allInitiatives } from '~/state/server';
import { collectStoryTaskIds } from '~/components/story/StoryRunner';
import { log } from '~/lib/log';

const KICK_DEBOUNCE_MS = 200;

export default function RoadmapRunner() {
  let kickTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceKick = (fn: () => void): void => {
    if (kickTimer !== null) clearTimeout(kickTimer);
    kickTimer = setTimeout(fn, KICK_DEBOUNCE_MS);
  };

  /** Dispatch the current initiative if no daemon run is in flight
   *  for it. Idempotent — multiple calls collapse via the debounce
   *  + the daemon-run-id guard. */
  const kickCurrent = async (): Promise<void> => {
    const run = roadmapRunStore.state.run;
    if (!run || run.status !== 'running') return;
    const initiativeId = run.queue[run.cursor];
    if (!initiativeId) {
      // Cursor walked off the end — mark done.
      roadmapRunStore.setStatus('done');
      return;
    }
    // Is there already a daemon run for this initiative?
    const existing = storyStore.runForInitiative(initiativeId);
    if (existing) {
      // Whether live or paused, link it. The story-level runner
      // (StoryRunner) drives advance/dispatch; we just observe.
      roadmapRunStore.setCurrentDaemonRunId(existing.id);
      return;
    }
    // No run yet — spawn one. Same path the per-card play uses.
    const initiative = allInitiatives().find((i) => i.id === initiativeId);
    if (!initiative) {
      roadmapRunStore.recordFailure(initiativeId, 'initiative not found');
      roadmapRunStore.advance();
      return;
    }
    const client = daemonStore.state.client;
    if (!client) {
      roadmapRunStore.recordFailure(initiativeId, 'no daemon client');
      return;
    }
    const taskIds = collectStoryTaskIds(initiativeId);
    if (taskIds.length === 0) {
      // Nothing to do — skip silently and move on.
      log.info('roadmap-run: skipping (no open tasks)', initiativeId);
      roadmapRunStore.advance();
      return;
    }
    // Fresh agent + conv per initiative (V87 contract). Reusing the
    // chatStore helper so the rail picks up the agent immediately.
    const conv = chatStore.createStoryConv({
      initiativeId,
      initiativeTitle: initiative.title ?? initiativeId,
    });
    const agentId = chatStore.state.convMeta[conv]?.agentId ?? '?';
    const res = await storyStore.start(client, {
      initiativeId,
      initiativeTitle: initiative.title ?? initiativeId,
      conv,
      agentId,
      agentTitle: initiative.title ?? initiativeId,
      taskIds,
    });
    if (!res.ok) {
      log.warn('roadmap-run: start failed', res.status, res.error);
      roadmapRunStore.recordFailure(initiativeId, `start ${res.status}`);
      roadmapRunStore.advance();
      return;
    }
    roadmapRunStore.setCurrentDaemonRunId(res.run.id);
  };

  // Boot-resume + cursor-change kick.
  createEffect(() => {
    const r = roadmapRunStore.state.run;
    if (!r || r.status !== 'running') return;
    // Touch cursor so the effect re-runs when we advance.
    void r.cursor;
    debounceKick(() => { void kickCurrent(); });
  });

  // Watch storyStore for the current initiative's daemon run; when
  // it terminates, advance the cursor.
  createEffect(() => {
    const r = roadmapRunStore.state.run;
    if (!r || r.status !== 'running') return;
    const initiativeId = r.queue[r.cursor];
    if (!initiativeId) return;
    // Find the run for this initiative in storyStore.state.runs.
    const matching = storyStore.state.runs.find((sr) => sr.initiativeId === initiativeId);
    if (!matching) return;
    if (matching.status === 'done') {
      log.info('roadmap-run: initiative done, advancing', { id: initiativeId, cursor: r.cursor });
      roadmapRunStore.advance();
    } else if (matching.status === 'cancelled' || matching.status === 'failed') {
      // Operator cancelled the inner run OR the daemon flagged it
      // failed. Record + advance so the roadmap pass continues
      // unless the operator also stops the roadmap-level run.
      roadmapRunStore.recordFailure(initiativeId, matching.status);
      log.info('roadmap-run: initiative ended badly, advancing', {
        id: initiativeId,
        status: matching.status,
      });
      roadmapRunStore.advance();
    }
  });

  onMount(() => {
    onCleanup(() => {
      if (kickTimer !== null) {
        clearTimeout(kickTimer);
        kickTimer = null;
      }
    });
  });

  return null;
}

/** Cancel the current sequential pass: cancel the in-flight daemon
 *  run (if any) and clear the queue. The story-level cancel runs
 *  through storyStore so the daemon's chat session + run record
 *  both flip to cancelled. */
export async function stopRoadmapRun(): Promise<void> {
  const r = roadmapRunStore.state.run;
  if (!r) return;
  roadmapRunStore.setStatus('stopping');
  const initiativeId = r.queue[r.cursor];
  if (initiativeId) {
    const live = storyStore.runForInitiative(initiativeId);
    const client = daemonStore.state.client;
    if (live && client) {
      await storyStore.cancel(client, live.id);
    }
  }
  roadmapRunStore.clear();
}

/** Build the queue + start. Pulled out so the InitiativesPanel button
 *  doesn't need to know about createStoryConv etc. */
export function startRoadmapRun(initiativeIds: string[]): void {
  if (!initiativeIds.length) {
    log.warn('roadmap-run: nothing to queue');
    return;
  }
  roadmapRunStore.start(initiativeIds);
}
