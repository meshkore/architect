/**
 * state/chat/ingest.ts — the two sinks for `chat.*` events, plus the
 * history replay that reuses them.
 *
 * The decision of WHAT a chat event does to a message list is made once,
 * in `reducer.applyChatEvent`. This module owns only the two ways to
 * write it down:
 *
 *   active cluster   → Solid's fine-grained `setState`, so a delta
 *                      touches one message instead of the whole array,
 *                      plus the live-session bookkeeping (pending-reply
 *                      flag, streaming-idle marker, window cap, the
 *                      work-* unarchive safety net).
 *   inactive cluster → the plain cached slice, which becomes visible
 *                      when the operator switches back.
 */

import type { DaemonClient, DaemonEvent } from '~/lib/daemon-client';
import { log } from '~/lib/log';
import {
  state,
  setState,
  activeClusterId,
  isHydrating,
  setHydrating,
  clearPendingReply,
  clearLastDelta,
} from './store';
import { applyChatEvent, applyPatchToList } from './reducer';
import { getOrCreateSlice, recordActivity } from './cluster-slices';
import { unarchiveConv } from './conv-actions';
import { capConvWindow, setInitialPaging } from './paging';

const LIVE_TEXT_EVENTS = new Set<string>([
  'chat.user',
  'chat.assistant.delta',
  'chat.assistant.final',
]);

/**
 * Ingest one daemon event into the ACTIVE cluster's store. Idempotent —
 * the same stream_id replaces in place rather than appending a duplicate.
 */
export function ingestEvent(ev: DaemonEvent): void {
  const conv = typeof ev.conv === 'string' ? ev.conv : null;
  if (!conv) return;
  // py-1.11.0 — safety net: an archived work-* conv that starts talking
  // again un-archives locally. The daemon would normally emit
  // `conv.unarchived` first; this is cheap insurance.
  if (
    !isHydrating() &&
    state.archivedConvs[conv] &&
    conv.startsWith('work-') &&
    LIVE_TEXT_EVENTS.has(ev.type)
  ) {
    unarchiveConv(conv);
  }

  const arr = state.convMap[conv] ?? [];
  const patch = applyChatEvent(arr, ev);
  if (patch.op === 'patch') setState('convMap', conv, patch.index, patch.fields);
  else if (patch.op === 'append') setState('convMap', conv, [...arr, patch.msg]);

  if (ev.type === 'chat.assistant.delta') {
    // A delta with no stream_id can't be attributed to a bubble; it is
    // dropped whole, side effects included (a half-applied delta would
    // clear the "preparing" flag with nothing on screen to replace it).
    if (patch.op === 'none') return;
    // V86p — first assistant chunk is here; drop the "preparing" flag.
    clearPendingReply(conv);
    // V89.2 — stamp last-delta so the bubble's idle hint can tell when
    // the agent has gone quiet mid-turn.
    setState('lastDeltaTsByConv', conv, Date.now());
    return;
  }
  if (ev.type === 'chat.assistant.final') {
    // V86p — a final without a prior delta also drops the pending flag.
    clearPendingReply(conv);
    clearLastDelta(conv);
    // 2026-06-12 — windowed-history cap after a LIVE final appends, so a
    // long session doesn't balloon the DOM. Never while hydrating (the
    // initial page is already ≤ INITIAL_PAGE).
    if (!isHydrating()) capConvWindow(conv);
    return;
  }
  if (ev.type === 'chat.cancelled') {
    clearPendingReply(conv);
    clearLastDelta(conv);
  }
}

/**
 * MP4 — route a chat event to the right cluster. Active → the reactive
 * store; inactive → the cached slice, so the operator sees the messages
 * on switch-back rather than a gap.
 */
export function ingestEventForCluster(clusterKey: string, ev: DaemonEvent): void {
  // MP5 — record activity regardless, so the rail's working slug and
  // unread dot react to background daemons too.
  recordActivity(clusterKey, ev);
  if (activeClusterId() === clusterKey) {
    ingestEvent(ev);
    return;
  }
  const conv = typeof ev.conv === 'string' ? ev.conv : null;
  if (!conv) return;
  const slice = getOrCreateSlice(clusterKey);
  const list = slice.convMap[conv] ?? [];
  const patch = applyChatEvent(list, ev);
  if (patch.op === 'none') return;
  slice.convMap[conv] = applyPatchToList(list, patch);
}

/**
 * Lazy-load a page of messages for `conv` and seed `convMap[conv]`.
 * `ChatThread` calls this when a conv gains focus; older pages come from
 * `paging.loadEarlierMessages`. History replays through `ingestEvent`
 * with `hydrating` set, so the same upsert/dedup logic that powers live
 * streaming also seeds the backlog.
 */
export async function loadConvMessagesPage(
  client: DaemonClient,
  conv: string,
  opts: { before?: string; limit?: number } = {},
): Promise<{ has_more: boolean; oldest_ts: string }> {
  const res = await client.chatConvMessages(conv, opts);
  if (!res.ok) {
    log.warn('loadConvMessagesPage failed', { conv, status: res.status, body: res.body.slice(0, 200) });
    return { has_more: false, oldest_ts: '' };
  }
  // First page (no `before`): reset convMap so a stale entry from a prior
  // session doesn't double up — BUT keep any in-flight streaming bubble
  // (A-CONVWINDOW-01). Wiping it dropped a live message when a WS delta
  // beat the history load on a fresh refresh. buildStream re-sorts by ts
  // and extracts `live` separately, so keeping the tail here is safe.
  if (!opts.before) {
    const liveTail = (state.convMap[conv] ?? []).filter(
      (m) => m.kind === 'assistant' && m.streaming,
    );
    setState('convMap', conv, liveTail);
  }
  setHydrating(true);
  try {
    for (const raw of res.data.messages) {
      const ev = raw as DaemonEvent;
      const t = typeof ev.type === 'string' ? ev.type : '';
      if (t !== 'chat.user' && t !== 'chat.assistant' && t !== 'chat.assistant.final' && t !== 'chat.cancelled') {
        continue;
      }
      // Older snapshots emit `chat.assistant` for finalised text; map it
      // so the reducer treats it as a closed turn.
      ingestEvent(t === 'chat.assistant' ? { ...ev, type: 'chat.assistant.final' } : ev);
    }
  } finally {
    setHydrating(false);
  }
  setInitialPaging(conv, !!res.data.has_more, res.data.oldest_ts ?? '');
  return { has_more: res.data.has_more, oldest_ts: res.data.oldest_ts };
}
