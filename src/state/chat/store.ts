/**
 * state/chat/store.ts — the package's private reactive core.
 *
 * Every other module writes through these two bindings; nothing outside
 * `state/chat/` may import this file (the public surface is the
 * `chatStore` facade in `index.ts`).
 */

import { createStore } from 'solid-js/store';
import { createSignal } from 'solid-js';
import { initialChatState, type ChatStoreState } from './types';

const [state, setState] = createStore<ChatStoreState>(initialChatState);
const [activeClusterId, setActiveClusterId] = createSignal<string | null>(null);

export { state, setState, activeClusterId, setActiveClusterId };

// py-1.11.0 — Set while pre-seeding convMap from a `chatConvMessages`
// pagination fetch, so the ingest reducer treats historical messages as
// rehydration (the work-* auto-unarchive guard stays inert, no window
// capping, no pending-reply bookkeeping).
let hydrating = false;

export function isHydrating(): boolean {
  return hydrating;
}

export function setHydrating(value: boolean): void {
  hydrating = value;
}

/** V86p — drop a conv's "preparing…" flag. Shared by the ingest reducer
 *  (first chunk arrived) and dispatch (the POST failed). */
export function clearPendingReply(conv: string): void {
  if (state.pendingReplyConvs[conv] === undefined) return;
  setState('pendingReplyConvs', (xs) => {
    const { [conv]: _drop, ...rest } = xs;
    return rest;
  });
}

/** V89.2 — drop the streaming-idle marker once a turn is over. */
export function clearLastDelta(conv: string): void {
  if (state.lastDeltaTsByConv[conv] === undefined) return;
  setState('lastDeltaTsByConv', (xs) => {
    const { [conv]: _drop, ...rest } = xs;
    return rest;
  });
}
