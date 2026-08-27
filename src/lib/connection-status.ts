/**
 * connection-status.ts — ONE derived truth for "is this project's
 * connection healthy right now?", bound to the daemon store.
 *
 * AX1 (cockpit-excellence). Everything that renders connection health
 * (header pill, project plate dot, the workspace banner, the rail's
 * per-row dot) reads this module, so those four surfaces can never
 * disagree. The rule itself is pure and lives in `~/lib/link-status`.
 */

import { daemonStore } from '~/state/daemon';
import { linkStatusFrom, isLinkDegraded, type LinkStatus } from '~/lib/link-status';

export { linkStatusFrom, isLinkDegraded, type LinkStatus };

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
