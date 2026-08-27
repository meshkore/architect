/**
 * project-switch.ts — project lifecycle orchestration: switch, stop-all,
 * forget.
 *
 * AX15 / ST-10: these three lived in `components/ProjectsRailRow.tsx`
 * and were imported by `App.tsx`, `OfflinePanel.tsx` and the add-project
 * wizard — app-level control flow exported from a leaf row component.
 * They move here; the row keeps only its own rendering.
 *
 * AX8 changed `forgetProject`: "forget" used to be cockpit-local only,
 * so with a live central daemon the row came back on the next discovery
 * pass (~1s) while the operator's alias, chat metadata, view state and
 * token had already been destroyed. It now deletes the project from the
 * daemon's registry first and only scrubs once that lands.
 */

import { createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { projectsStore } from '~/state/projects';
import { serverStore } from '~/state/server';
import { chatStore } from '~/state/chat';
import { railUiStore } from '~/state/rail-ui';
import { findClusterPort, liveClusters } from '~/components/projects-rail/discovery';
import { log } from '~/lib/log';
import * as kp from '~/lib/known-projects';
import { clearCachedSnapshot } from '~/lib/snapshot-cache';
import type { DaemonClient } from '~/lib/daemon-client';

export interface SwitchFallback {
  display: string;
  cluster_id: string | null;
  cluster_name: string | null;
}

// FC-2: keyed by project (row key), not port.
const switchProjectInFlight = new Set<string>();

/**
 * V108 — per-project re-entrancy guard. A failed/flapping switch (the
 * OfflinePanel /health auto-watcher + its port-reconcile effect both
 * retrying the SAME port) stacked infinite concurrent switchProject
 * calls, each firing a /health probe. Those probes saturated the
 * browser's per-host connection pool and the UI froze in an endless
 * `switchProject → switchToPort → probing` loop (ikamiro hang, field
 * 2026-06-15). Coalesce: while a switch to this project is in flight,
 * re-entrant calls no-op immediately.
 *
 * FC-2 (daemon-centralized) — coalesce by PROJECT (key), not port. One
 * daemon serves many projects on ONE port, so a port-keyed guard
 * blocked switching between sibling projects.
 */
export async function switchProject(
  port: number,
  key: string,
  fallback?: SwitchFallback,
): Promise<boolean> {
  if (switchProjectInFlight.has(key)) {
    log.debug('switchProject coalesced — already in flight', { port, key });
    return false;
  }
  switchProjectInFlight.add(key);
  try {
    return await switchProjectImpl(port, key, fallback);
  } finally {
    switchProjectInFlight.delete(key);
  }
}

async function switchProjectImpl(
  port: number,
  key: string,
  fallback?: SwitchFallback,
): Promise<boolean> {
  projectsStore.clearNewBadge(key);

  // V86l — reconcile against live discovery BEFORE probing. If the
  // operator's stored port is stale (typical case: a daemon self-update
  // briefly moved the port and the kp.list() entry captured the
  // transient one) but discovery already knows the cluster_id is alive
  // elsewhere, use the live port. `/health` is authoritative.
  let effectivePort = port;
  if (fallback?.cluster_id) {
    const live = liveClusters().get(fallback.cluster_id);
    if (live && live.port !== port) {
      log.info('reconciling stale port via live discovery', {
        cluster_id: fallback.cluster_id, stale: port, live: live.port,
      });
      effectivePort = live.port;
    }
  }

  try { localStorage.setItem('meshcore-last-port', String(effectivePort)); } catch { /* quota */ }
  // FC-2 — pass the selected project's id so the daemon routes to it.
  let outcome = await daemonStore.switchToPortDetailed(effectivePort, fallback?.cluster_id ?? undefined);

  // V86l — second-chance reconciliation. If the probe failed AND we know
  // which cluster_id we're after, scan 5570–5589 once for it. Covers the
  // boot path where discovery hadn't run yet so liveClusters was empty.
  if (!outcome.ok && fallback?.cluster_id && outcome.reason === 'no-daemon') {
    const found = await findClusterPort(fallback.cluster_id);
    if (found && found.port !== effectivePort) {
      log.info('cluster found at new port', { cluster_id: fallback.cluster_id, port: found.port });
      try { localStorage.setItem('meshcore-last-port', String(found.port)); } catch { /* quota */ }
      const retry = await daemonStore.switchToPortDetailed(found.port, fallback.cluster_id);
      if (retry.ok) {
        // The canonical attach already cleared any offline pick anchored
        // to the stale port — be explicit.
        daemonStore.clearOfflineSelection();
        return true;
      }
      outcome = retry;
    }
  }

  if (!outcome.ok) {
    // AX9 — 'cancelled' means the operator walked away from the token
    // prompt. That is not an outage: parking the row in OfflinePanel
    // would be a lie and would steal the selection from the project they
    // actually clicked.
    if (outcome.reason === 'cancelled') return false;
    // V86b — switch failed for a real reason, so register the operator's
    // selection: the rail shows the row as selected and the cockpit body
    // shows OfflinePanel with "start the daemon" guidance.
    if (fallback) {
      daemonStore.selectOffline({
        key,
        port: effectivePort,
        cluster_id: fallback.cluster_id,
        cluster_name: fallback.cluster_name,
        display: fallback.display,
        // AX10 — cluster-mismatch is a real, distinct failure (an old
        // daemon that ignores the project header) but the panel only
        // speaks the three transport reasons; surface it as 'unknown'
        // with the detail already logged by the switch flow.
        reason: outcome.reason === 'cluster-mismatch' ? 'unknown' : outcome.reason,
      });
    } else {
      log.warn('switch failed — no fallback provided', { port: effectivePort, reason: outcome.reason });
    }
  }
  return outcome.ok;
}

/**
 * V86 — Cancel every running agent turn on a given cluster. The rail's
 * stop button is a panic-stop ("4-5 agents working here, stop them
 * NOW"), not a daemon shutdown (that lives in the operator's terminal).
 *
 * Iterates the cluster's `workingConvs` and POSTs /chat/cancel on each
 * via the cluster's OWN DaemonInstance — so it works on inactive
 * projects too.
 */
export async function stopAllAgents(clusterKey: string): Promise<{ cancelled: number; failed: number }> {
  const inst = daemonStore.state.instances[clusterKey];
  if (!inst) return { cancelled: 0, failed: 0 };
  const activity = chatStore.state.clusterActivity[clusterKey];
  const convs = activity ? [...activity.workingConvs] : [];
  if (convs.length === 0) return { cancelled: 0, failed: 0 };
  const results = await Promise.all(
    convs.map(async (conv) => {
      try {
        const res = await inst.client.chatCancel(conv);
        return res.ok;
      } catch {
        return false;
      }
    }),
  );
  return {
    cancelled: results.filter((x) => x).length,
    failed: results.filter((x) => !x).length,
  };
}

// ── forget ──────────────────────────────────────────────────────────

/** Last forget failure, keyed by row key, so the rail can show it where
 *  the operator clicked. Cleared on the next attempt. */
const [forgetErrors, setForgetErrors] = createSignal<Record<string, string>>({});
export const forgetErrorFor = (key: string): string | undefined => forgetErrors()[key];
export function clearForgetError(key: string): void {
  setForgetErrors((prev) => {
    if (!(key in prev)) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  });
}

/**
 * Pick a client that can talk to the daemon hosting this row.
 * `DELETE /projects/<id>` is a GLOBAL endpoint (no project header), so
 * ANY client pointed at that daemon works — which matters because a row
 * the operator never opened has no instance of its own.
 */
function clientForRow(clusterKey: string, port: number): DaemonClient | null {
  const own = daemonStore.state.instances[clusterKey];
  if (own) return own.client;
  const sibling = Object.values(daemonStore.state.instances).find((i) => i.port === port);
  if (sibling) return sibling.client;
  const active = daemonStore.state.client;
  if (active && daemonStore.state.health?.port === port) return active;
  return null;
}

export interface ForgetOutcome {
  ok: boolean;
  /** True when the daemon's registry entry was deleted (or was already
   *  absent). False means we only scrubbed local state. */
  deletedRemotely: boolean;
  error?: string;
}

/**
 * AX8 — forget a project for real.
 *
 * Reachable daemon: `DELETE /projects/<id>` FIRST, and only scrub local
 * state once it lands. The daemon's delete is registry-only — it drops
 * the id from its in-memory table and rewrites `projects.json`; the
 * project folder on disk is never touched (daemon/projectsapi.py
 * `project_unregister`). It refuses (409) to delete its own default
 * (boot) project.
 *
 * Unreachable daemon: local-only scrub, same as before.
 *
 * A failed delete does NOT scrub: destroying the alias, conv metadata,
 * view state and token while the row is about to be re-upserted by the
 * next discovery pass is exactly the data loss this task exists to fix.
 */
export async function forgetProject(
  target: { cluster_id?: string | null; port: number },
  onAfter?: () => void,
): Promise<ForgetOutcome> {
  const clusterKey = target.cluster_id && target.cluster_id.trim().length > 0
    ? target.cluster_id
    : `port:${target.port}`;
  clearForgetError(clusterKey);

  let deletedRemotely = false;
  if (target.cluster_id) {
    const client = clientForRow(clusterKey, target.port);
    if (client) {
      const res = await client.projectDelete(target.cluster_id, AbortSignal.timeout(10_000));
      // 404 = the daemon already doesn't know it; that IS the end state
      // we want, so treat it as success and scrub.
      if (res.ok || res.status === 404) {
        deletedRemotely = true;
      } else {
        const detail = res.status === 409
          ? "the daemon refuses to drop its own default (boot) project — point it at another project first"
          : res.error || res.body.slice(0, 160) || `HTTP ${res.status}`;
        log.warn('forget: daemon refused DELETE /projects', { cluster_id: target.cluster_id, status: res.status, detail });
        setForgetErrors((prev) => ({ ...prev, [clusterKey]: detail }));
        return { ok: false, deletedRemotely: false, error: detail };
      }
    } else {
      log.info('forget: no reachable daemon for this row — local scrub only', { clusterKey });
    }
  }

  log.info('forget — full eviction', { clusterKey, deletedRemotely });
  daemonStore.disconnectInstance(clusterKey);
  serverStore.clearForCluster(clusterKey);
  chatStore.clearClusterChat(clusterKey);
  clearCachedSnapshot(clusterKey);
  kp.forget({ cluster_id: target.cluster_id ?? undefined, port: target.port });
  // Drop any offline selection that pointed at the same row so the
  // cockpit doesn't keep rendering OfflinePanel for a project that no
  // longer exists in the rail.
  const offline = daemonStore.state.offlineSelection;
  if (offline && offline.key === clusterKey) daemonStore.clearOfflineSelection();
  // After eviction, force the cockpit into the "no selection" state. The
  // App-level effect picks it up: with exactly one project left it
  // auto-selects; otherwise the operator gets the empty panel.
  // disconnectInstance's built-in fallback (jumping to the first
  // remaining instance) is too eager here.
  daemonStore.clearActiveSelection();
  projectsStore.refresh();
  railUiStore.clear();
  onAfter?.();
  return { ok: true, deletedRemotely };
}
