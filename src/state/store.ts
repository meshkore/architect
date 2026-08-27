/**
 * state/store.ts — the last surviving sliver of the pre-Solid global
 * store: a bounded ring of raw daemon events.
 *
 * AX4 (cockpit-excellence). What used to live here — a `/state`
 * snapshot plus `attach()` / `refresh()` — was dead weight AND a bug.
 * `refresh()` did `await client.state() as DaemonSnapshot`, but
 * `DaemonClient.state()` returns `Result<unknown>` (`{ok,data,status}`),
 * so every field the store read (`roadmap`, `modules`, `initiatives`)
 * was undefined. It fired the fattest endpoint in the API on every
 * project switch and every `state.rebuilt`, unguarded against A→B
 * races, and no component ever read the result: `serverStore`
 * (state/server.ts) has owned the real, cluster-scoped snapshot for
 * several versions, and `state/live.ts` — this module's WS partner —
 * was already deleted as dead.
 *
 * What remains is `events()`, still read by `lib/chat-stream.ts` to
 * interleave tool / task.* bubbles into a conv. NOTE: nothing calls
 * `appendEvent` today (the event bus routes those events elsewhere),
 * so the ring is empty in practice; it stays because chat-stream's
 * contract expects it and re-arming the feed is a chat-side decision,
 * not a connection-layer one.
 */

import { createSignal } from 'solid-js';
import type { DaemonEvent } from '~/lib/daemon-client';

const MAX_EVENTS = 500;
const [events, setEvents] = createSignal<DaemonEvent[]>([]);

function appendEvent(ev: DaemonEvent): void {
  setEvents((prev) => {
    const next = [...prev, ev];
    return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
  });
}

export const store = {
  events,
  appendEvent,
};
