/**
 * state/chat/reducer.ts — the ONE decision table for `chat.*` events.
 *
 * AX12 (cockpit-excellence). Two ~120-line copies of this logic used to
 * exist: `ingestEvent` wrote the reactive store, `ingestEventForCluster`
 * mutated a cached plain slice for a background project, and they had
 * already drifted. They are now two thin sinks over this function.
 *
 * It returns a PATCH rather than a new array on purpose: the active sink
 * applies `patch` through Solid's fine-grained `setState(..., index,
 * fields)` so a streaming delta touches one message instead of replacing
 * the whole list. The cached sink copies the array. Both make exactly
 * the same decision about WHICH message and WHICH fields.
 *
 * Side effects that belong to the active session only — the pending-reply
 * flag, the streaming-idle marker, window capping, the work-* unarchive
 * safety net — stay in the active sink; they are not part of the list
 * transformation.
 */

import type { DaemonEvent } from '~/lib/daemon-client';
import { cleanChatText, parseAttachments } from '~/lib/chat-sanitize';
import type { ChatMsg } from './types';

export type ChatEventPatch =
  /** Nothing to write (unknown event, missing stream_id, no match). */
  | { op: 'none' }
  /** Merge `fields` into the message at `index`. */
  | { op: 'patch'; index: number; fields: Partial<ChatMsg> }
  /** Append a new message to the end of the list. */
  | { op: 'append'; msg: ChatMsg };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrUndef = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Decide what one `chat.*` event does to a conv's message list.
 *
 * Pure: same list + same event ⇒ same patch, no store access.
 */
export function applyChatEvent(list: readonly ChatMsg[], ev: DaemonEvent): ChatEventPatch {
  switch (ev.type) {
    case 'chat.user': {
      const text = str(ev.text);
      const author = strOrUndef(ev.author);
      const attachments = parseAttachments(ev.attachments);
      // Replace the optimistic placeholder with the canonical echo so
      // the bubble isn't duplicated (client and daemon timestamps differ).
      const phIdx = list.findIndex(
        (m) => m.kind === 'user' && m._placeholder_user && m.text === text && (!author || m.author === author),
      );
      if (phIdx >= 0) {
        return {
          op: 'patch',
          index: phIdx,
          fields: { author, ts: strOrUndef(ev.ts), attachments, _placeholder_user: undefined },
        };
      }
      return {
        op: 'append',
        msg: { kind: 'user', text, author, ts: strOrUndef(ev.ts), attachments },
      };
    }

    case 'chat.assistant.delta': {
      const streamId = strOrUndef(ev.stream_id);
      if (!streamId) return { op: 'none' };
      const cleaned = cleanChatText(str(ev.text));
      const idx = list.findIndex((m) => m.kind === 'assistant' && m.stream_id === streamId);
      if (idx >= 0) return { op: 'patch', index: idx, fields: { text: cleaned, streaming: true } };
      return {
        op: 'append',
        msg: {
          kind: 'assistant',
          text: cleaned,
          author: strOrUndef(ev.author),
          ts: strOrUndef(ev.ts),
          streaming: true,
          stream_id: streamId,
        },
      };
    }

    case 'chat.assistant.final': {
      const streamId = strOrUndef(ev.stream_id);
      const cleaned = cleanChatText(str(ev.text));
      // A final with no stream_id can never match an existing bubble —
      // `streamId !== undefined` in the predicate is what keeps a
      // stream_id-less final from adopting a stream_id-less draft.
      const idx = list.findIndex(
        (m) => m.kind === 'assistant' && streamId !== undefined && m.stream_id === streamId,
      );
      if (idx >= 0) return { op: 'patch', index: idx, fields: { text: cleaned, streaming: false } };
      return {
        op: 'append',
        msg: {
          kind: 'assistant',
          text: cleaned,
          author: strOrUndef(ev.author),
          ts: strOrUndef(ev.ts),
          streaming: false,
          stream_id: streamId,
        },
      };
    }

    case 'chat.cancelled': {
      const lastIdx = list.length - 1;
      const last = list[lastIdx];
      if (last && last.kind === 'assistant' && last.streaming) {
        return { op: 'patch', index: lastIdx, fields: { streaming: false, cancelled: true } };
      }
      return { op: 'none' };
    }

    default:
      // py-1.11.0 Phase 2 — legacy `chat.archived` / `chat.unarchived`
      // were removed from the daemon's broadcast set; the snapshot.v1
      // path uses `conv.archived` / `conv.unarchived` instead.
      return { op: 'none' };
  }
}

/** Apply a patch to a plain array (the cached-slice sink). Returns the
 *  same reference when the patch is a no-op. */
export function applyPatchToList(list: ChatMsg[], patch: ChatEventPatch): ChatMsg[] {
  if (patch.op === 'append') return [...list, patch.msg];
  if (patch.op === 'patch') {
    const prev = list[patch.index];
    if (!prev) return list;
    const next = list.slice();
    next[patch.index] = { ...prev, ...patch.fields };
    return next;
  }
  return list;
}
