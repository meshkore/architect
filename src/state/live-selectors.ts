/**
 * live-selectors.ts — store-bound answers to "what is running right now".
 *
 * AX14 (cockpit-excellence). The predicates themselves are pure and
 * live in `~/lib/conv-state`; this module is the thin binding to
 * `chatStore` so every consumer — the roadmap queue bar, the chat
 * scope strip, the agents rail — reads the SAME truth. Three
 * divergent copies used to answer this question, and the operator saw
 * the result: the chat showed a run in progress while the queue bar
 * still offered to start it.
 *
 * Import these instead of re-deriving from `chatStore.state.convs`.
 */

import { chatStore } from '~/state/chat';
import {
  isConvWorkingFrom,
  pickLatestArchitectConv,
  type ConvStateLike,
} from '~/lib/conv-state';

/** True when the conv has an assistant turn in flight. */
export function isConvWorking(conv: string): boolean {
  const snap = chatStore.state.convs[conv] ?? null;
  return isConvWorkingFrom(snap, chatStore.state.convMap[conv]);
}

/**
 * The architect conv the cockpit's Run All / Stop controls act on, or
 * null when the roster has none.
 *
 * Prefers the daemon snapshot (`convs`); falls back to locally known
 * conv metadata so a conv created this session — before the next
 * snapshot lands — is still addressable.
 */
export function activeArchitectConv(): string | null {
  const fromSnapshot = pickLatestArchitectConv(Object.values(chatStore.state.convs));
  if (fromSnapshot) return fromSnapshot;

  const local: ConvStateLike[] = Object.entries(chatStore.state.convMeta).map(([conv, meta]) => ({
    conv,
    agent_type: meta.type ?? null,
    archived: !!chatStore.state.archivedConvs[conv],
    last_activity_at: (chatStore.state.convMap[conv] ?? []).at(-1)?.ts ?? '',
  }));
  return pickLatestArchitectConv(local);
}

/** True when the architect is mid-run — the queue bar's "is it busy". */
export function isArchitectWorking(): boolean {
  const conv = activeArchitectConv();
  return conv ? isConvWorking(conv) : false;
}
