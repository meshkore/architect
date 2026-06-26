/**
 * ProjectsRailRow — V85.
 *
 * Refactored to drop the hover overlay completely. Chrome's HTML5
 * drag + position:absolute overlay combination kept stealing clicks
 * across five attempts. Now:
 *
 *   - The row is a plain <div>. No draggable on it (drag-reorder
 *     temporarily off — restored once we move it to a dedicated
 *     drag-handle in a follow-up).
 *   - For the ACTIVE project only, an action row renders below the
 *     name. It always shows [Edit] [Stop if live] [Delete].
 *   - Click Edit → name swaps to <input>, action row becomes
 *     [Save] [Cancel].
 *   - Click Delete → action row becomes "Remove from rail? [Cancel] [Confirm]".
 *   - Click Stop → action row becomes "Shutdown daemon? [Cancel] [Confirm]".
 *
 * Inactive rows render plain — click to switch. The active marker
 * (green left bar) is the visual selection indicator.
 */

import { Show } from 'solid-js';
import { daemonStore, selectedRowKey } from '~/state/daemon';
import { projectsStore } from '~/state/projects';
import { serverStore } from '~/state/server';
import { chatStore } from '~/state/chat';
import { railUiStore } from '~/state/rail-ui';
import { findClusterPort, liveClusters } from '~/components/projects-rail/discovery';
import { log } from '~/lib/log';
import * as kp from '~/lib/known-projects';
import { openProjectDebugModal } from '~/components/modals/ProjectDebugModal';

export type RailRowData = {
  key: string;
  port: number;
  base: string;
  cluster_id: string | null;
  cluster_name: string | null;
  display: string;
  initials: string;
  live: boolean;
  isNew: boolean;
  working?: boolean;
  /** MP5 — true when this (inactive) cluster received events since the
   *  operator last viewed it. Drives the small amber dot on the row. */
  hasUnread?: boolean;
  pendingReview?: boolean;
  /** V107.4 — true when a non-archived roadmap-architect conv exists on
   *  this cluster. Drives a soft emerald pulse on the working bar so
   *  the operator can see "Run All in progress" from the rail between
   *  turns, not just while streaming (which is what `working` covers). */
  architectActive?: boolean;
};

// Row mode + draft now live in `railUiStore` (state/rail-ui.ts) so the
// UI survives any `<For>` reconciliation that swaps the component
// instance underneath the operator's click.

/**
 * V86 — Cancel every running agent turn on a given cluster. Replaces
 * the old "shutdown daemon" semantics that the rail's stop button
 * used to expose. The operator's intent on that button now is a
 * panic-stop: "4-5 agents working in this project, I want them all
 * to stop NOW."
 *
 * Iterates the cluster's `workingConvs` (tracked globally in
 * chatStore.clusterActivity by MP5) and POSTs /chat/cancel on each
 * via the cluster's own DaemonInstance — works even on inactive
 * projects because each instance still has its own client.
 *
 * (Daemon shutdown lives in the operator's terminal — `meshcore stop`
 * or POST /shutdown directly — since it's a less common action than
 * cancelling chat turns.)
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

const switchProjectInFlight = new Set<string>(); // FC-2: keyed by project (row key), not port

/**
 * V108 — per-port re-entrancy guard. A failed/flapping switch (the
 * OfflinePanel /health auto-watcher + its port-reconcile effect both
 * retrying the SAME port) stacked infinite concurrent switchProject
 * calls, each firing a /health probe. Those probes saturated the
 * browser's per-host connection pool and the UI froze in an endless
 * `switchProject → switchToPort → probing` loop (ikamiro hang, field
 * 2026-06-15). Coalesce: while a switch to this port is in flight,
 * re-entrant calls no-op immediately — no reactive mutation, no probe —
 * until the first one settles (attach succeeds, or fails and the slow
 * 2s OfflinePanel poll can retry one-at-a-time).
 */
export async function switchProject(
  port: number,
  key: string,
  fallback?: { display: string; cluster_id: string | null; cluster_name: string | null },
): Promise<boolean> {
  // FC-2 (daemon-centralized) — coalesce by PROJECT (key), not port. One daemon
  // serves many projects on ONE port, so a port-keyed guard blocked switching
  // between sibling projects (clicking B while A's switch was in flight no-oped
  // forever). Keying by the row key lets each project switch independently.
  if (switchProjectInFlight.has(key)) {
    console.log('[RAIL] switchProject coalesced — switch to this project already in flight', { port, key });
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
  fallback?: { display: string; cluster_id: string | null; cluster_name: string | null },
): Promise<boolean> {
  console.log('[RAIL] switchProject called', { port, key });
  projectsStore.clearNewBadge(key);

  // V86l — reconcile against live discovery BEFORE probing. If the
  // operator's stored port is stale (typical case: a daemon
  // self-update briefly moved the port, the bookmark / kp.list()
  // entry captured the transient port) but the discovery scan
  // already knows the cluster_id is alive at a different port, use
  // the live port instead. `/health` is authoritative.
  let effectivePort = port;
  if (fallback?.cluster_id) {
    const live = liveClusters().get(fallback.cluster_id);
    if (live && live.port !== port) {
      log.info('[RAIL] reconciling stale port via live discovery', {
        cluster_id: fallback.cluster_id, stale: port, live: live.port,
      });
      effectivePort = live.port;
    }
  }

  try { localStorage.setItem('meshcore-last-port', String(effectivePort)); } catch { /* quota */ }
  // FC-2 — pass the selected project's id so the daemon routes to it (one
  // daemon may serve many projects; the instance is keyed by projectId).
  let outcome = await daemonStore.switchToPortDetailed(effectivePort, fallback?.cluster_id ?? undefined);
  console.log('[RAIL] switchProject result', { port: effectivePort, key, outcome });

  // V86l — second-chance reconciliation. If the probe failed AND we
  // know which cluster_id we're after, do a one-shot scan of the
  // 5570–5589 range looking for that cluster. This covers the boot
  // path where discovery hadn't run yet so liveClusters was empty.
  if (!outcome.ok && fallback?.cluster_id && outcome.reason === 'no-daemon') {
    log.info('[RAIL] probe failed, scanning ports for cluster_id', {
      cluster_id: fallback.cluster_id, stale: effectivePort,
    });
    const found = await findClusterPort(fallback.cluster_id);
    if (found && found.port !== effectivePort) {
      log.info('[RAIL] cluster found at new port', {
        cluster_id: fallback.cluster_id, port: found.port,
      });
      try { localStorage.setItem('meshcore-last-port', String(found.port)); } catch { /* quota */ }
      const retry = await daemonStore.switchToPortDetailed(found.port, fallback?.cluster_id ?? undefined);
      if (retry.ok) {
        // Drop any prior offline pick that was anchored to the
        // stale port — the canonical attach above already cleared
        // it, but be explicit.
        daemonStore.clearOfflineSelection();
        return true;
      }
      outcome = retry;
    }
  }

  if (!outcome.ok) {
    // V86b — switch failed, but we still register the operator's
    // selection so the rail shows the row as selected and the cockpit
    // body shows OfflinePanel with "start the daemon" guidance.
    if (fallback) {
      daemonStore.selectOffline({
        key,
        port: effectivePort,
        cluster_id: fallback.cluster_id,
        cluster_name: fallback.cluster_name,
        display: fallback.display,
        reason: outcome.reason,
      });
    } else {
      console.warn('[RAIL] switch failed — no fallback provided', { port: effectivePort });
    }
  }
  return outcome.ok;
}

function forgetProjectImmediate(target: { cluster_id?: string | null; port: number }, onAfter: () => void): void {
  const clusterKey = target.cluster_id && target.cluster_id.trim().length > 0
    ? target.cluster_id
    : `port:${target.port}`;
  console.log('[RAIL] forget — full eviction', { clusterKey });
  daemonStore.disconnectInstance(clusterKey);
  serverStore.clearForCluster(clusterKey);
  chatStore.clearClusterChat(clusterKey);
  kp.forget({ cluster_id: target.cluster_id ?? undefined, port: target.port });
  // Drop any offline selection that pointed at the same row so the
  // cockpit doesn't keep rendering OfflinePanel for a project that
  // no longer exists in the rail.
  const offline = daemonStore.state.offlineSelection;
  if (offline && offline.key === clusterKey) {
    daemonStore.clearOfflineSelection();
  }
  // After eviction, force the cockpit into the "no selection" state.
  // The App-level effect picks it up: if exactly one project remains
  // it auto-selects it; otherwise the operator gets the empty panel.
  // disconnectInstance's built-in fallback (jumping to the first
  // remaining instance) is too eager — we want the operator to
  // confirm which project they switch to next.
  daemonStore.clearActiveSelection();
  projectsStore.refresh();
  railUiStore.clear();
  onAfter();
}

export interface ProjectsRailRowProps {
  row: RailRowData;
  short: boolean;
  onAfterStop: () => void;
}

export default function ProjectsRailRow(props: ProjectsRailRowProps) {
  const r = () => props.row;
  // V86d — `isActive` is read directly off `daemonStore` (not the
  // per-row `active` field) so the green bar + action row morph
  // doesn't depend on `<For>` re-issuing the row prop. The For
  // component still remounts on every chatStore/wsState tick (rows()
  // returns new object references), but the highlight state survives
  // because each new mount reads the same daemon-store selectedRowKey.
  const isActive = () => selectedRowKey() === r().key;
  const mode = () => railUiStore.modeFor(r().key);
  const nameDraft = () => railUiStore.state.draftName;

  const wrapCls = (): string => {
    const cls = ['proj-row-wrap'];
    if (!r().live) cls.push('is-stopped');
    if (r().isNew) cls.push('is-new');
    if (r().hasUnread) cls.push('has-unread');
    return cls.join(' ');
  };

  const rowCls = (): string => {
    const cls = ['proj-row'];
    if (isActive()) cls.push('active');
    if (r().working) cls.push('is-working');
    if (r().architectActive) cls.push('is-architect-active');
    if (r().pendingReview) cls.push('is-pending-review');
    return cls.join(' ');
  };

  const onRowClick = (e: MouseEvent): void => {
    // If the click landed inside the action row or the inline input,
    // let those handlers do their thing — don't trigger a switch.
    const t = e.target as HTMLElement | null;
    if (t && t.closest('.proj-row-actions, .proj-row-name--editing')) return;
    if (mode() === 'editing') return;
    void switchProject(r().port, r().key, {
      display: r().display,
      cluster_id: r().cluster_id,
      cluster_name: r().cluster_name,
    });
  };

  const commit = (save: boolean): void => {
    if (save) {
      const k: kp.KnownProject = {
        port: r().port,
        base: r().base,
        last_seen: new Date().toISOString(),
        cluster_id: r().cluster_id ?? undefined,
      };
      kp.setAlias(k, nameDraft().trim());
      projectsStore.refresh();
    }
    railUiStore.clear();
  };

  const confirmDelete = (): void => {
    railUiStore.clear();
    forgetProjectImmediate({ cluster_id: r().cluster_id, port: r().port }, props.onAfterStop);
  };

  const confirmStopAll = async (): Promise<void> => {
    railUiStore.clear();
    const res = await stopAllAgents(r().key);
    if (res.failed > 0) {
      // V86 — no native alert(). The chatStore.clusterActivity will
      // reflect the new workingConvs count, and the row's bouncing
      // slug + stop button will disappear for the cancelled convs.
      // Partial failures are logged for the operator's console.
      console.warn('[RAIL] stop-all partial', {
        cancelled: res.cancelled,
        failed: res.failed,
        cluster: r().key,
      });
    }
  };

  /** Number of agent runs currently in flight on this row's cluster.
   *  Reads chatStore.clusterActivity reactively. */
  const runningCount = (): number =>
    chatStore.state.clusterActivity[r().key]?.workingConvs.length ?? 0;

  const showActions = (): boolean => !props.short && isActive();

  return (
    <div
      class={wrapCls()}
      title={`${r().display} · :${r().port}${r().cluster_id ? ' · ' + r().cluster_id : ''}${!r().live ? ' · stopped' : ''}`}
      onClick={onRowClick}
    >
      <Show
        when={mode() === 'editing'}
        fallback={
          <div class={rowCls()}>
            <span class="proj-working-bar" aria-hidden="true" />
            <span class="proj-row-name">{r().display}</span>
            <span class="proj-row-initials">{r().initials}</span>
          </div>
        }
      >
        <div class={rowCls()} style={{ cursor: 'text' }}>
          <span class="proj-working-bar" aria-hidden="true" />
          <input
            class="proj-row-name proj-row-name--editing"
            value={nameDraft()}
            autofocus
            onInput={(e) => railUiStore.setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(true); }
              else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </Show>

      {/* Action row — only on active project in full mode. Morphs
          between idle / editing / confirm-delete / confirm-stop. */}
      <Show when={showActions()}>
        <div class="proj-row-actions">
          <Show when={mode() === 'idle'}>
            {/* V86 — order: stop (only when agents running) · edit · trash.
                Stop now means "cancel every running agent turn on this
                cluster", not "shutdown daemon". The badge in the title
                shows the count so the operator confirms scope before
                clicking. */}
            <Show when={runningCount() > 0}>
              <button
                type="button"
                class="proj-row-action is-stop"
                title={`Stop all running agents (${runningCount()} in flight)`}
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('[RAIL] STOP-ALL click', { port: r().port, running: runningCount() });
                  railUiStore.beginConfirmStop(r().key);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1.5" />
                </svg>
              </button>
            </Show>
            <button
              type="button"
              class="proj-row-action is-edit"
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                console.log('[RAIL] EDIT click', { port: r().port });
                railUiStore.beginEdit(r().key, r().display);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            {/* V103 — Diagnostic snapshot. Opens a centered modal with
                two tabs (in-memory stores + localStorage) so the
                operator can paste the cockpit's per-project state
                into a debug session for review. Read-only; same
                outline style as the other action buttons. */}
            <button
              type="button"
              class="proj-row-action is-edit"
              title="Inspect cockpit state for this project"
              onClick={(e) => {
                e.stopPropagation();
                openProjectDebugModal({
                  port: r().port,
                  cluster_id: r().cluster_id ?? null,
                  display: r().display,
                });
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                {/* Database cylinder — three stacked discs */}
                <ellipse cx="12" cy="5" rx="8" ry="2.4" />
                <path d="M4 5v6c0 1.3 3.6 2.4 8 2.4s8-1.1 8-2.4V5" />
                <path d="M4 11v6c0 1.3 3.6 2.4 8 2.4s8-1.1 8-2.4v-6" />
              </svg>
            </button>
            <button
              type="button"
              class="proj-row-action is-delete"
              title="Forget project"
              onClick={(e) => {
                e.stopPropagation();
                console.log('[RAIL] DELETE click', { port: r().port });
                railUiStore.beginConfirmDelete(r().key);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
            </button>
          </Show>

          <Show when={mode() === 'editing'}>
            <button type="button" class="proj-row-action is-cancel has-label"
              onClick={(e) => { e.stopPropagation(); commit(false); }}>cancel</button>
            <button type="button" class="proj-row-action is-save has-label"
              onClick={(e) => { e.stopPropagation(); commit(true); }}>save</button>
          </Show>

          <Show when={mode() === 'confirm-delete'}>
            <span class="proj-row-prompt">remove?</span>
            <button type="button" class="proj-row-action is-cancel has-label"
              onClick={(e) => { e.stopPropagation(); railUiStore.clear(); }}>no</button>
            <button type="button" class="proj-row-action is-danger has-label"
              onClick={(e) => { e.stopPropagation(); confirmDelete(); }}>remove</button>
          </Show>

          <Show when={mode() === 'confirm-stop-all'}>
            <span class="proj-row-prompt">stop {runningCount()} agent{runningCount() === 1 ? '' : 's'}?</span>
            <button type="button" class="proj-row-action is-cancel has-label"
              onClick={(e) => { e.stopPropagation(); railUiStore.clear(); }}>no</button>
            <button type="button" class="proj-row-action is-danger has-label"
              onClick={(e) => { e.stopPropagation(); void confirmStopAll(); }}>stop all</button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
