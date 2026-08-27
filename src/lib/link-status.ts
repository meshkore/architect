/**
 * link-status.ts — the pure rule for "is this project's connection
 * healthy right now?".
 *
 * AX1 (cockpit-excellence). Two independent signals decide it and they
 * used to be read separately (or not at all): the boot/attach `phase`
 * on the daemon store, and the per-instance WebSocket `wsState`. The
 * header pill read only `phase` — which stays `connected` while the
 * socket is reconnecting AND after it has given up — so the operator
 * saw a green pill over a frozen cockpit.
 *
 * The socket is what carries live data; a stalled socket is a stale
 * cockpit even when HTTP still answers. So the socket dominates
 * whenever the store believes it is attached.
 *
 * Kept free of store imports (types only, which erase at runtime) so it
 * is directly testable. The store-bound readers live in
 * `connection-status.ts`.
 */

import type { ConnectionPhase } from '~/state/daemon';
import type { DaemonWSState } from '~/lib/ws';

/**
 * `connected`   — attached, socket open. Everything is live.
 * `reconnecting`— transient: dialing, or inside the retry budget.
 * `paused`      — attached but the socket gave up (`fatal`/`closed`).
 *                 Data on screen is stale until a revive lands.
 * `offline`     — no daemon attached at all (boot probe failed, the
 *                 operator picked an offline row, unauthorized, error).
 */
export type LinkStatus = 'connected' | 'reconnecting' | 'paused' | 'offline';

/** Derive the combined status from the two raw signals. */
export function linkStatusFrom(phase: ConnectionPhase, wsState: DaemonWSState): LinkStatus {
  if (phase === 'probing' || phase === 'connecting') return 'reconnecting';
  if (phase !== 'connected') return 'offline';
  switch (wsState) {
    case 'open':
      return 'connected';
    case 'connecting':
    case 'reconnecting':
      return 'reconnecting';
    case 'fatal':
    case 'closed':
      return 'paused';
    // 'idle' is the sliver between attachClient() and the first dial —
    // reporting it as anything but connected makes every switch flash amber.
    default:
      return 'connected';
  }
}

/** True while the cockpit should mark on-screen data as possibly stale. */
export function isLinkDegraded(s: LinkStatus): boolean {
  return s === 'reconnecting' || s === 'paused';
}
