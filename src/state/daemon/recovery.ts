/**
 * state/daemon/recovery.ts — what to do when an instance's WebSocket
 * gives up (AX15 / ST-4; behaviour fixed by AX1).
 *
 * Extracted verbatim in intent from the closure that used to live
 * inside `attachClient`. Takes its collaborators as arguments so this
 * module never imports the daemon store (which imports it).
 *
 * Three outcomes for a `fatal` socket:
 *   1. the cluster now answers on a DIFFERENT port  → hot-swap to it;
 *   2. the cluster answers on the SAME port         → redial (a fatal
 *      socket never retries by itself — `connect()` resets the budget);
 *   3. the cluster answers nowhere                  → hand the project
 *      to the centre-zone reconnect UI.
 */

import { log } from '~/lib/log';
import type { DaemonWSState } from '~/lib/ws';

export interface RecoveryDeps {
  /** Current port + cluster_id of the instance, or null if it is gone. */
  instanceInfo(key: string): { port: number; clusterId: string | null } | null;
  /** Re-dial the instance's socket with a fresh retry budget. */
  redial(key: string): void;
  /** Locate a live daemon serving `clusterId` across the local range. */
  findClusterPort(clusterId: string): Promise<{ port: number } | null>;
  /** Attach the cluster at a newly-discovered port. */
  switchToPort(port: number): Promise<unknown>;
  /** Drop into the OfflinePanel reconnect flow for this project. */
  markDisconnected(key: string): void;
}

/**
 * Build the `onState` reaction for one instance. The returned function
 * ignores every state but `fatal` and is re-entrancy guarded, so a
 * flapping socket can't stack recovery attempts.
 */
export function createWsFatalRecovery(
  key: string,
  deps: RecoveryDeps,
): (s: DaemonWSState) => void {
  let recovering = false;
  return (s: DaemonWSState): void => {
    if (s !== 'fatal' || recovering) return;
    const info = deps.instanceInfo(key);
    const cid = info?.clusterId;
    if (!cid) return;
    recovering = true;
    void (async () => {
      try {
        const found = await deps.findClusterPort(cid);
        const current = deps.instanceInfo(key);
        if (!current) return; // instance was forgotten while we probed
        if (found && found.port !== current.port) {
          log.info('ws-fatal: cluster moved ports, hot-swapping', {
            cluster_id: cid, stale: current.port, live: found.port,
          });
          try { localStorage.setItem('meshcore-last-port', String(found.port)); } catch { /* quota */ }
          await deps.switchToPort(found.port);
          return;
        }
        if (found) {
          // AX1 — same port, daemon alive: this is a socket-level glitch (a
          // daemon restart that outlasted the 6-retry budget, or a laptop
          // wake). The pre-AX1 code commented "let the socket retry on its
          // own" — but a `fatal` socket never retries, so the project sat
          // frozen behind a green pill until the 60s health poll noticed.
          log.info('ws-fatal: daemon still on the same port — redialing', { cluster_id: cid, port: current.port });
          deps.redial(key);
          return;
        }
        // Daemon is gone (not a port move) → self-healing reconnect UI in the
        // centre zone (auto-retry + manual-restart guidance). Rail untouched.
        deps.markDisconnected(key);
      } finally {
        recovering = false;
      }
    })();
  };
}
