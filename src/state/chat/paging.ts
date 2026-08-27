/**
 * state/chat/paging.ts — the windowed history loader.
 *
 * A long-lived conv has hundreds of persisted messages. The UI renders a
 * sliding window: INITIAL_PAGE on focus, +PAGE per scroll-up, hard-capped
 * at UI_MESSAGE_CAP. The daemon keeps everything; we just don't paint
 * past the cap.
 *
 * The first-page loader lives in `ingest.ts` — it replays history through
 * the same reducer that powers live streaming.
 */

import type { DaemonClient, DaemonEvent } from '~/lib/daemon-client';
import { log } from '~/lib/log';
import { cleanChatText } from '~/lib/chat-sanitize';
import { state, setState } from './store';
import { PAGE, UI_MESSAGE_CAP, type ChatMsg } from './types';

function listLen(conv: string): number {
  return (state.convMap[conv] ?? []).length;
}

/**
 * Trim a conv's rendered window to the newest UI_MESSAGE_CAP messages.
 * Called after a LIVE final appends.
 *
 * A-CONVWINDOW-01 — this must NOT set `paging.capped`: it trims the
 * OLDEST messages, which are still on disk, so it is not a pagination
 * boundary. Marking capped here made scroll-up permanently refuse to
 * refetch messages that exist. The trimmed tail's oldest ts becomes the
 * new scroll-up cursor.
 */
export function capConvWindow(conv: string): void {
  const list = state.convMap[conv] ?? [];
  if (list.length <= UI_MESSAGE_CAP) return;
  const next = list.slice(list.length - UI_MESSAGE_CAP);
  setState('convMap', conv, next);
  const p = state.paging[conv];
  if (p) {
    setState('paging', conv, {
      hasMore: true,
      oldestTs: next[0]?.ts ?? p.oldestTs,
    });
  }
}

/** Record the pagination cursor after the first page landed. */
export function setInitialPaging(conv: string, hasMore: boolean, fallbackOldestTs: string): void {
  const list = state.convMap[conv] ?? [];
  const oldest = list[0] ? (list[0].ts ?? '') : fallbackOldestTs;
  setState('paging', conv, {
    hasMore,
    oldestTs: oldest,
    loading: false,
    capped: list.length >= UI_MESSAGE_CAP,
  });
}

function historyMsg(ev: DaemonEvent): ChatMsg | null {
  const t = typeof ev.type === 'string' ? ev.type : '';
  if (t === 'chat.user') {
    return {
      kind: 'user',
      text: String(ev.text ?? ''),
      author: String(ev.author ?? 'operator'),
      ts: String(ev.ts ?? ''),
    };
  }
  if (t === 'chat.assistant' || t === 'chat.assistant.final') {
    return {
      kind: 'assistant',
      text: cleanChatText(String(ev.text ?? '')),
      streaming: false,
      ts: String(ev.ts ?? ''),
      stream_id: typeof ev.stream_id === 'string' ? ev.stream_id : undefined,
    };
  }
  if (t === 'chat.cancelled') {
    return {
      kind: 'assistant',
      text: String(ev.text ?? ''),
      streaming: false,
      cancelled: true,
      ts: String(ev.ts ?? ''),
    };
  }
  return null;
}

/**
 * Load the next older PAGE for `conv` and PREPEND it. No-ops when there
 * is no more history, a fetch is already in flight, or the UI cap is
 * reached. Returns how many messages were prepended so the caller can
 * preserve scroll position.
 *
 * The older page is built by hand rather than replayed through the
 * reducer: the reducer appends, and these belong at the front, ahead of
 * a possible live tail.
 */
export async function loadEarlierMessages(client: DaemonClient, conv: string): Promise<number> {
  const p = state.paging[conv];
  if (!p || !p.hasMore || p.loading) return 0;
  if (listLen(conv) >= UI_MESSAGE_CAP) {
    setState('paging', conv, 'capped', true);
    return 0;
  }
  setState('paging', conv, 'loading', true);
  const res = await client.chatConvMessages(conv, { before: p.oldestTs, limit: PAGE });
  if (!res.ok) {
    setState('paging', conv, 'loading', false);
    log.warn('loadEarlierMessages failed', { conv, status: res.status });
    return 0;
  }
  const older: ChatMsg[] = [];
  for (const ev of res.data.messages) {
    const m = historyMsg(ev as DaemonEvent);
    if (m) older.push(m);
  }
  const merged = [...older, ...(state.convMap[conv] ?? [])];
  // Respect the UI cap: keep the NEWEST UI_MESSAGE_CAP and stop loading.
  let next = merged;
  let capped = false;
  if (merged.length > UI_MESSAGE_CAP) {
    next = merged.slice(merged.length - UI_MESSAGE_CAP);
    capped = true;
  }
  setState('convMap', conv, next);
  setState('paging', conv, {
    hasMore: !!res.data.has_more && !capped,
    oldestTs: next[0] ? (next[0].ts ?? '') : p.oldestTs,
    loading: false,
    capped,
  });
  return older.length;
}
