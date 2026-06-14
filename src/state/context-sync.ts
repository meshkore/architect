/**
 * context-sync.ts — live refresh signal for the Context tab.
 *
 * The daemon owns `.meshkore/context/`: it's the daemon that spawns the
 * agents that edit those files, so the daemon always knows when the
 * context changed. Its file-poll loop broadcasts a `context.changed` WS
 * event; the event-bus bumps this revision counter; ContextPanel keys
 * its tree + body resources on it, so the tree re-fetches in real time.
 *
 * No manual "sync" button — context is presumed always in sync with the
 * daemon. This tiny standalone module avoids coupling that contract to
 * daemonStore (which is large + churny).
 */

import { createSignal } from 'solid-js';

const [rev, setRev] = createSignal(0);

/** Reactive accessor — read inside a resource source to refetch on bump. */
export const contextRev = rev;

/** Called by the event-bus on a `context.changed` WS event. */
export function bumpContextRev(): void {
  setRev((n) => n + 1);
}
