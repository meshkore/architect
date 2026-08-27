/**
 * connection-status.ts — ONE derived truth for "is this project's
 * connection healthy right now?".
 *
 * AX1 (cockpit-excellence). Two independent signals decide it and they
 * used to be read separately (or not at all): the boot/attach `phase`
 * on the daemon store, and the per-instance WebSocket `wsState`. The
 * header pill read only `phase` — which stays `connected` while the
 * socket is reconnecting AND after it has given up — so the operator
 * saw a green pill over a frozen cockpit. Everything that renders
 * connection health (header pill, project plate dot, the workspace
 * banner, the rail's per-row dot) reads this module instead, so those
 * four surfaces can never disagree.
 *
 * The socket is what carries live data; a stalled socket is a stale
 * cockpit even when HTTP still answers. So the socket dominates
 * whenever the store believes it is attached.
 */

import { daemonStore, type ConnectionPhase } from '~/state/daemon';
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

/** Combined status of the instance the cockpit is currently showing. */
export function activeLinkStatus(): LinkStatus {
  return linkStatusFrom(daemonStore.state.phase, daemonStore.state.wsState);
}

/**
 * Combined status of ONE instance, regardless of whether it is the
 * active one. An instance only exists once it has attached, so `phase`
 * is `connected` for it by construction — the socket decides.
 * Returns null when no instance is tracked for this cluster key (the
 * rail then falls back to its last discovery probe).
 */
export function instanceLinkStatus(clusterKey: string): LinkStatus | null {
  const inst = daemonStore.state.instances[clusterKey];
  if (!inst) return null;
  return linkStatusFrom('connected', inst.wsState);
}

/** True while the cockpit should mark on-screen data as possibly stale. */
export function isLinkDegraded(s: LinkStatus): boolean {
  return s === 'reconnecting' || s === 'paused';
}
