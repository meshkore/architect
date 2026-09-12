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
import { teamStore } from '~/state/team';
import { clientsStore } from '~/state/clients';
import { viewStore } from '~/state/view';
import { storyStore } from '~/state/story';
import { bindCluster as queueBindCluster } from '~/lib/queue';
import { railUiStore } from '~/state/rail-ui';
import { discoverProjects, findClusterPort, liveClusters } from '~/components/projects-rail/discovery';
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

  // AX17 — refuse to switch into a row the operator just deleted. The
  // tombstone means the rail row is already gone; a raced click (double
  // click, keyboard) must NOT rebind or repaint — the current project's
  // view stays exactly as it is, no stale-data flash.
  if (fallback?.cluster_id && kp.isDeleted(fallback.cluster_id)) {
    log.info('switchProject refused — project was just deleted', { cluster_id: fallback.cluster_id });
    return false;
  }

  // AX18 — synchronous prebind: the workspace must NEVER paint the old
  // project's data under the new project's selection. BEFORE any network:
  // move the rail highlight, point the server facade at the target (fresh
  // key → empty snapshot → boot gate shows BootingPanel loader; known key
  // → in-memory slice, AX3), and reset every per-cluster UI mirror
  // (agents roster, chat, view, clients, queue, runs). The full
  // bindActiveCluster after attach is idempotent over this (same
  // cluster_id → bindCluster no-ops) and only adds the fetches.
  const targetClusterId = fallback?.cluster_id ?? null;
  const targetKey = targetClusterId && targetClusterId.trim().length > 0
    ? targetClusterId
    : `port:${port}`;
  const prevActiveId: string | null = daemonStore.state.activeId;
  const prevPort = projectsStore.state.activePort;
  const prevClusterId: string | null = projectsStore.state.activeClusterId;
  projectsStore.setActive(port, targetClusterId);
  serverStore.beginSwitch(targetKey);
  chatStore.bindCluster(targetClusterId);
  viewStore.bindCluster(targetClusterId);
  teamStore.bindCluster(targetClusterId);
  clientsStore.bindCluster(targetClusterId);
  queueBindCluster(targetClusterId);
  storyStore.resetForClusterSwap();

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
    // AX18 — undo the prebind: nothing attached, the previous project
    // is still the live one. Point the facade + mirrors back at it and
    // revalidate so the workspace repaints instead of hanging on a
    // loader for a project that never attached.
    if (outcome.reason === 'cancelled') {
      if (prevPort !== null) projectsStore.setActive(prevPort, prevClusterId);
      serverStore.setActiveCluster(prevActiveId);
      if (prevActiveId) {
        const prevCid = daemonStore.state.instances[prevActiveId]?.health?.cluster_id ?? prevClusterId;
        chatStore.bindCluster(prevCid);
        viewStore.bindCluster(prevCid);
        teamStore.bindCluster(prevCid);
        clientsStore.bindCluster(prevCid);
        queueBindCluster(prevCid);
        storyStore.resetForClusterSwap();
        void import('~/lib/cluster-bind').then((m) => m.rehydrateActiveCluster(prevActiveId));
      }
      return false;
    }
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
 * AX8 — forget a project for real. AX17 — the local eviction is now
 * OPTIMISTIC: the rail row, its stores and its selection die THIS TICK,
 * and the daemon `DELETE /projects/<id>` follows in the background. The
 * operator asked for instant; the daemon's registry lag (~60s before its
 * /projects table + discovery stop re-listing the id) must never keep a
 * dead row on screen. The delete tombstone (known-projects) vetoes any
 * re-upsert while the daemon catches up.
 *
 * The daemon's delete is registry-only — it drops the id from its
 * in-memory table and rewrites `projects.json`; the project folder on
 * disk is never touched (daemon/projectsapi.py `project_unregister`). It
 * refuses (409) to delete its own default (boot) project.
 *
 * When the daemon REFUSES or is unreachable-after-evict, the tombstone is
 * lifted and a rediscovery is kicked so the row comes back instead of
 * vanishing while the daemon still owns it.
 */
export async function forgetProject(
  target: { cluster_id?: string | null; port: number },
  onAfter?: () => void,
): Promise<ForgetOutcome> {
  const clusterKey = target.cluster_id && target.cluster_id.trim().length > 0
    ? target.cluster_id
    : `port:${target.port}`;
  clearForgetError(clusterKey);

  // 1. Optimistic local eviction — synchronous, this tick.
  log.info('forget — optimistic local eviction', { clusterKey });
  evictLocalProject(target, clusterKey);
  onAfter?.();

  // 2. Daemon DELETE in the background.
  let deletedRemotely = false;
  if (target.cluster_id) {
    const client = clientForRow(clusterKey, target.port);
    if (client) {
      const res = await client.projectDelete(target.cluster_id, AbortSignal.timeout(10_000));
      // 404 = the daemon already doesn't know it; that IS the end state
      // we want, so treat it as success.
      if (res.ok || res.status === 404) {
        deletedRemotely = true;
      } else {
        const detail = res.status === 409
          ? "the daemon refuses to drop its own default (boot) project — point it at another project first"
          : res.error || res.body.slice(0, 160) || `HTTP ${res.status}`;
        log.warn('forget: daemon refused DELETE /projects — resurrecting row', { cluster_id: target.cluster_id, status: res.status, detail });
        setForgetErrors((prev) => ({ ...prev, [clusterKey]: detail }));
        // Undo the optimistic eviction: the daemon still owns this project.
        kp.revive(target.cluster_id);
        projectsStore.refresh();
        void discoverProjects();
        return { ok: false, deletedRemotely: false, error: detail };
      }
    } else {
      log.info('forget: no reachable daemon for this row — local scrub only', { clusterKey });
    }
  }
  return { ok: true, deletedRemotely };
}

/** AX17 — the synchronous half of forgetProject: drop every local trace of
 *  the row (instance, cluster stores, known-projects + tombstone, selection)
 *  so the next paint already shows the project gone. */
function evictLocalProject(
  target: { cluster_id?: string | null; port: number },
  clusterKey: string,
): void {
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
}
