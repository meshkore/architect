/**
 * methods/chat.ts — dispatch, archive, the py-1.11.0 conv reads and the
 * Standard v16 per-conv turn queue.
 *
 * DAH2(b), initiative `daemon-audit-hardening` — the four chat reads below
 * used to pass `requireAuth: false`. That flag does not merely "allow" an
 * anonymous call: it SUPPRESSES the Authorization header even when a token
 * is in hand, and it also disables the 401 self-heal (see core.send). So
 * the cockpit was reading conversation content — `/chat/conv/<id>/messages`
 * returns full message BODIES — over an unauthenticated channel by
 * construction, and the daemon could not gate those routes without breaking
 * the cockpit.
 *
 * Sending the token is harmless against a daemon that does not yet require
 * it, which is what makes this the SAFE HALF of a two-repo change: this
 * ships first, the daemon-side gate second. Reversing that order would leave
 * every un-updated cockpit without chat history until the CDN deploy landed.
 *
 * Token availability is not a concern at these call sites: `switchToPort`
 * auto-unlocks a LOCAL cluster (origin-gated GET /auth/local-token) BEFORE
 * the instance is attached, so a token exists by the time any chat read
 * runs; and a stale one recovers through the 401 self-heal.
 */

import { RoadmapMethods } from './roadmap';
import type { Result } from '../result';
import type { DaemonEvent } from '../types/system';
import type {
  ChatConvMessagesResponse,
  ChatConvMetaResponse,
  ChatConvsResponse,
  ChatQueueItem,
  ChatQueueResponse,
  ChatSnapshotResponse,
  DispatchBody,
  DispatchResponse,
} from '../types/chat';

export class ChatMethods extends RoadmapMethods {
  async chatDispatch(body: DispatchBody, signal?: AbortSignal): Promise<Result<DispatchResponse>> {
    return this.request<DispatchResponse>('POST', '/chat/dispatch', body, signal);
  }

  async chatCancel(conv: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/chat/cancel', { conv }, signal);
  }

  async messages(
    body: { text: string; author?: string; conv?: string },
    signal?: AbortSignal,
  ): Promise<Result<DaemonEvent>> {
    return this.request<DaemonEvent>('POST', '/messages', body, signal);
  }

  /** V104 — POST /chat/archive. The cockpit's local archive button
   *  used to ONLY update the per-tab `archivedConvs` signal, never
   *  syncing to the daemon. Hard refresh + V102 hydrate then re-
   *  populated the rail with the un-synced convs because the daemon
   *  had no record. Now the local archive path calls this and the
   *  daemon broadcasts `chat.archived` so EVERY tab updates. */
  async chatArchive(conv: string, signal?: AbortSignal): Promise<Result<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>('POST', '/chat/archive', { conv }, signal);
  }

  /** V104 — POST /chat/unarchive. Symmetric to chatArchive. */
  async chatUnarchive(conv: string, signal?: AbortSignal): Promise<Result<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>('POST', '/chat/unarchive', { conv }, signal);
  }

  /** Boot consolidated payload — convs + archives + paused + quota +
   *  debug in one round-trip. Replaces the legacy chain of /state +
   *  /chat/archives + /health.chat_active_convs hydration. */
  async chatSnapshot(signal?: AbortSignal): Promise<Result<ChatSnapshotResponse>> {
    return this.request<ChatSnapshotResponse>('GET', '/chat/snapshot', undefined, signal);
  }

  /** Canonical conv list. Cockpit reads this on WS `state.rebuilt` or
   *  any conv.* event when the snapshot.v1 path is active and we
   *  need to resync. */
  async chatConvs(signal?: AbortSignal): Promise<Result<ChatConvsResponse>> {
    return this.request<ChatConvsResponse>('GET', '/chat/convs', undefined, signal);
  }

  /** One conv's normalised metadata. Deep-link / resync helper. */
  async chatConvMeta(conv: string, signal?: AbortSignal): Promise<Result<ChatConvMetaResponse>> {
    return this.request<ChatConvMetaResponse>(
      'GET', `/chat/conv/${encodeURIComponent(conv)}/meta`, undefined, signal,
    );
  }

  /** Paginated message reader. `before` is the ISO ts of the oldest
   *  event from the previous page (omit to fetch the newest page).
   *  Returns events in chronological order (oldest → newest); the
   *  cockpit's reducer expects that ordering. */
  async chatConvMessages(
    conv: string,
    opts?: { before?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<Result<ChatConvMessagesResponse>> {
    const params = new URLSearchParams();
    if (opts?.before) params.set('before', opts.before);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const path = `/chat/conv/${encodeURIComponent(conv)}/messages${qs ? '?' + qs : ''}`;
    return this.request<ChatConvMessagesResponse>('GET', path, undefined, signal);
  }

  // ── Standard v16 chat-turn queue (V107.41, daemon py-1.12.12+) ────

  async queueList(conv: string, signal?: AbortSignal): Promise<Result<ChatQueueResponse>> {
    return this.request<ChatQueueResponse>(
      'GET', `/chat/conv/${encodeURIComponent(conv)}/queue`, undefined, signal,
    );
  }

  async queueEnqueue(conv: string, text: string, signal?: AbortSignal): Promise<Result<ChatQueueItem>> {
    return this.request<ChatQueueItem>(
      'POST', `/chat/conv/${encodeURIComponent(conv)}/queue`, { text }, signal,
    );
  }

  async queueEdit(conv: string, id: string, text: string, signal?: AbortSignal): Promise<Result<ChatQueueItem>> {
    return this.request<ChatQueueItem>(
      'POST', `/chat/conv/${encodeURIComponent(conv)}/queue/${encodeURIComponent(id)}/edit`, { text }, signal,
    );
  }

  async queueMove(
    conv: string,
    id: string,
    position: number,
    signal?: AbortSignal,
  ): Promise<Result<{ items: ChatQueueItem[] }>> {
    return this.request<{ items: ChatQueueItem[] }>(
      'POST', `/chat/conv/${encodeURIComponent(conv)}/queue/${encodeURIComponent(id)}/move`, { position }, signal,
    );
  }

  async queuePromote(conv: string, id: string, signal?: AbortSignal): Promise<Result<ChatQueueItem>> {
    return this.request<ChatQueueItem>(
      'POST', `/chat/conv/${encodeURIComponent(conv)}/queue/${encodeURIComponent(id)}/promote`, undefined, signal,
    );
  }

  async queueDelete(conv: string, id: string, signal?: AbortSignal): Promise<Result<{ removed: string }>> {
    return this.request<{ removed: string }>(
      'DELETE', `/chat/conv/${encodeURIComponent(conv)}/queue/${encodeURIComponent(id)}`, undefined, signal,
    );
  }
}
