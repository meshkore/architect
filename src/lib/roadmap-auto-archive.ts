/**
 * roadmap-auto-archive.ts — "all tasks done → the story leaves the
 * active wall" (V106.3), plus the stale-archive-shadow cleanup
 * (V107.29).
 *
 * AX14 (cockpit-excellence). This is roadmap POLICY, and it used to
 * live inside InitiativesPanel — which meant it silently stopped
 * running the moment the operator switched zone, leaving finished
 * stories parked on the active wall until they happened to have the
 * roadmap open when the last task landed. It is driven from a
 * module-level root here instead, so it observes the store for the
 * lifetime of the tab and the panel only READS the exiting set.
 *
 * Two-stage on purpose: a 30ms settle (so a burst of task updates from
 * one poll doesn't fire N times), then the story is marked `exiting`
 * for the CSS collapse, and only when THAT finishes is it archived.
 * Every stage re-checks the condition — a task reopened mid-animation
 * cancels the archive.
 */

import { createEffect, createRoot, createSignal } from 'solid-js';
import { allInitiatives, allTasks, type ServerTask } from '~/state/server';
import { viewStore } from '~/state/view';

/** Must match the collapse transition in styles/roadmap-timeline.css. */
export const EXIT_ANIM_MS = 550;

const SETTLE_MS = 30;

const [exiting, setExiting] = createSignal<Set<string>>(new Set());

/** Initiatives mid-collapse. The panel keeps them visible while the
 *  height/opacity transition plays. Reactive. */
export const exitingInitiatives = (): Set<string> => exiting();

function tasksByInitiative(): Map<string, ServerTask[]> {
  const map = new Map<string, ServerTask[]>();
  for (const t of allTasks()) {
    if (!t.initiative) continue;
    const arr = map.get(t.initiative);
    if (arr) arr.push(t);
    else map.set(t.initiative, [t]);
  }
  return map;
}

function isStillCompleteAndUnarchived(id: string): boolean {
  if (viewStore.isInitiativeArchived(id)) return false;
  const tasks = tasksByInitiative().get(id) ?? [];
  if (tasks.length === 0) return false;
  return tasks.every((t) => t.status === 'done');
}

let started = false;

/**
 * Start the driver. Idempotent, and called at module load below — the
 * import itself is what keeps the policy alive across panel unmounts.
 * The root is never disposed; it lives as long as the tab does.
 */
export function startRoadmapAutoArchive(): void {
  if (started) return;
  started = true;

  createRoot(() => {
    const pendingTimers = new Map<string, number>();

    // Stale archive shadow cleanup (V107.29): an initiative moved back to
    // `active` on disk must not stay hidden by a leftover local archive flag.
    createEffect(() => {
      for (const it of allInitiatives()) {
        if (it.status === 'active' && viewStore.isInitiativeArchived(it.id)) {
          viewStore.setInitiativeArchived(it.id, false);
        }
      }
    });

    createEffect(() => {
      const tbi = tasksByInitiative();
      const exitingSet = exiting();
      for (const it of allInitiatives()) {
        if (viewStore.isInitiativeArchived(it.id)) continue;
        const tasks = tbi.get(it.id) ?? [];
        if (tasks.length === 0) continue;
        if (!tasks.every((t) => t.status === 'done')) continue;
        if (exitingSet.has(it.id)) continue;
        if (pendingTimers.has(it.id)) continue;

        const id = it.id;
        const settle = window.setTimeout(() => {
          if (!isStillCompleteAndUnarchived(id)) {
            pendingTimers.delete(id);
            return;
          }
          setExiting((s) => { const n = new Set(s); n.add(id); return n; });
          const collapse = window.setTimeout(() => {
            if (isStillCompleteAndUnarchived(id)) {
              viewStore.setInitiativeArchived(id, true);
            }
            setExiting((s) => { const n = new Set(s); n.delete(id); return n; });
            pendingTimers.delete(id);
          }, EXIT_ANIM_MS);
          pendingTimers.set(id, collapse);
        }, SETTLE_MS);
        pendingTimers.set(id, settle);
      }
    });
  });
}

startRoadmapAutoArchive();
