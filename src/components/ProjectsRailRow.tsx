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

import { Show, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { projectsStore } from '~/state/projects';
import { serverStore } from '~/state/server';
import { chatStore } from '~/state/chat';
import * as kp from '~/lib/known-projects';

export type RailRowData = {
  key: string;
  port: number;
  base: string;
  cluster_id: string | null;
  cluster_name: string | null;
  display: string;
  initials: string;
  live: boolean;
  active: boolean;
  isNew: boolean;
  working?: boolean;
  /** MP5 — true when this (inactive) cluster received events since the
   *  operator last viewed it. Drives the small amber dot on the row. */
  hasUnread?: boolean;
  pendingReview?: boolean;
};

type RowMode = 'idle' | 'editing' | 'confirm-delete' | 'confirm-stop-all';

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

export async function switchProject(port: number, key: string): Promise<boolean> {
  console.log('[RAIL] switchProject called', { port, key });
  projectsStore.clearNewBadge(key);
  try { localStorage.setItem('meshcore-last-port', String(port)); } catch { /* quota */ }
  const ok = await daemonStore.switchToPort(port);
  console.log('[RAIL] switchProject result', { port, key, ok });
  if (!ok) {
    // V86 — no more native alert(). The rail's row visually reflects
    // the failed switch (stays on its current active project, no
    // green-bar move on the target). Diagnostics go to console; a
    // proper in-rail toast is queued — for now we just refuse silently
    // since the common case (clicking a stopped row) is self-evident
    // visually. AutoUpdateFlow and other callers can await this
    // boolean and surface their own UI when it matters.
    console.warn('[RAIL] switch failed — no daemon on target port', { port });
  }
  return ok;
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
  projectsStore.refresh();
  onAfter();
}

export interface ProjectsRailRowProps {
  row: RailRowData;
  short: boolean;
  onAfterStop: () => void;
}

export default function ProjectsRailRow(props: ProjectsRailRowProps) {
  const [mode, setMode] = createSignal<RowMode>('idle');
  const [nameDraft, setNameDraft] = createSignal(props.row.display);
  const r = () => props.row;

  const wrapCls = (): string => {
    const cls = ['proj-row-wrap'];
    if (!r().live) cls.push('is-stopped');
    if (r().isNew) cls.push('is-new');
    if (r().hasUnread) cls.push('has-unread');
    return cls.join(' ');
  };

  const rowCls = (): string => {
    const cls = ['proj-row'];
    if (r().active) cls.push('active');
    if (r().working) cls.push('is-working');
    if (r().pendingReview) cls.push('is-pending-review');
    return cls.join(' ');
  };

  const onRowClick = (e: MouseEvent): void => {
    // If the click landed inside the action row or the inline input,
    // let those handlers do their thing — don't trigger a switch.
    const t = e.target as HTMLElement | null;
    if (t && t.closest('.proj-row-actions, .proj-row-name--editing')) return;
    if (mode() === 'editing') return;
    void switchProject(r().port, r().key);
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
    setMode('idle');
  };

  const confirmDelete = (): void => {
    setMode('idle');
    forgetProjectImmediate({ cluster_id: r().cluster_id, port: r().port }, props.onAfterStop);
  };

  const confirmStopAll = async (): Promise<void> => {
    setMode('idle');
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

  const showActions = (): boolean => !props.short && r().active;

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
            onInput={(e) => setNameDraft(e.currentTarget.value)}
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
                  setMode('confirm-stop-all');
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
                setNameDraft(r().display);
                setMode('editing');
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              type="button"
              class="proj-row-action is-delete"
              title="Forget project"
              onClick={(e) => {
                e.stopPropagation();
                console.log('[RAIL] DELETE click', { port: r().port });
                setMode('confirm-delete');
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
              onClick={(e) => { e.stopPropagation(); setMode('idle'); }}>no</button>
            <button type="button" class="proj-row-action is-danger has-label"
              onClick={(e) => { e.stopPropagation(); confirmDelete(); }}>remove</button>
          </Show>

          <Show when={mode() === 'confirm-stop-all'}>
            <span class="proj-row-prompt">stop {runningCount()} agent{runningCount() === 1 ? '' : 's'}?</span>
            <button type="button" class="proj-row-action is-cancel has-label"
              onClick={(e) => { e.stopPropagation(); setMode('idle'); }}>no</button>
            <button type="button" class="proj-row-action is-danger has-label"
              onClick={(e) => { e.stopPropagation(); void confirmStopAll(); }}>stop all</button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
