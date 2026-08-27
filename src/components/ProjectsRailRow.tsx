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
 *   - Click Delete → action row becomes "Forget project? [Cancel] [Forget]".
 *   - Click Stop → action row becomes "Shutdown daemon? [Cancel] [Confirm]".
 *
 * Inactive rows render plain — click to switch. The active marker
 * (green left bar) is the visual selection indicator.
 *
 * AX15 — switchProject / stopAllAgents / forgetProject moved to
 * `lib/project-switch.ts`; this file is rendering only.
 */

import { Show, createSignal } from 'solid-js';
import { selectedRowKey } from '~/state/daemon';
import { railUiStore } from '~/state/rail-ui';
import { chatStore } from '~/state/chat';
import { projectsStore } from '~/state/projects';
import {
  switchProject,
  stopAllAgents,
  forgetProject,
  forgetErrorFor,
  clearForgetError,
} from '~/lib/project-switch';
import { log } from '~/lib/log';
import * as kp from '~/lib/known-projects';
import { openProjectDebugModal } from '~/components/modals/ProjectDebugModal';

/** AX6 — per-row liveness. `live` = the socket is open; `reconnecting`
 *  = inside the WS retry budget; `dead` = gave up, or never detected. */
export type RailRowDot = 'live' | 'reconnecting' | 'dead';

export type RailRowData = {
  key: string;
  port: number;
  base: string;
  cluster_id: string | null;
  cluster_name: string | null;
  display: string;
  initials: string;
  live: boolean;
  /** AX6 — 3-state connection dot. Derived from the instance's real
   *  wsState when one exists, else from the last discovery probe. */
  dot: RailRowDot;
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

export { switchProject, stopAllAgents } from '~/lib/project-switch';

const DOT_TITLE: Record<RailRowDot, string> = {
  live: 'Connected — live updates flowing',
  reconnecting: 'Reconnecting…',
  dead: 'Not connected — no live updates',
};

const DOT_CLASS: Record<RailRowDot, string> = {
  live: 'bg-emerald-400',
  reconnecting: 'bg-amber-400 animate-pulse-soft',
  dead: 'bg-gray-600',
};

function LivenessDot(props: { state: RailRowDot }) {
  return (
    <span
      class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_CLASS[props.state]}`}
      title={DOT_TITLE[props.state]}
      aria-label={DOT_TITLE[props.state]}
    />
  );
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
  // doesn't depend on `<For>` re-issuing the row prop.
  const isActive = () => selectedRowKey() === r().key;
  const mode = () => railUiStore.modeFor(r().key);
  const nameDraft = () => railUiStore.state.draftName;
  const [forgetting, setForgetting] = createSignal(false);

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

  // AX8 — the confirm awaits the daemon's DELETE. Only a successful (or
  // already-absent) registry delete scrubs the local alias / chat meta /
  // view state / token, and only then do we let the caller rescan — a
  // rescan before the delete lands simply re-upserts the row.
  const confirmDelete = async (): Promise<void> => {
    if (forgetting()) return;
    setForgetting(true);
    try {
      const res = await forgetProject(
        { cluster_id: r().cluster_id, port: r().port },
        props.onAfterStop,
      );
      if (res.ok) railUiStore.clear();
    } finally {
      setForgetting(false);
    }
  };

  const confirmStopAll = async (): Promise<void> => {
    railUiStore.clear();
    const res = await stopAllAgents(r().key);
    if (res.failed > 0) {
      // V86 — no native alert(). chatStore.clusterActivity reflects the
      // new workingConvs count, and the row's bouncing slug + stop button
      // disappear for the cancelled convs. Partial failures are logged.
      log.warn('stop-all partial', {
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
      title={`${r().display} · :${r().port}${r().cluster_id ? ' · ' + r().cluster_id : ''} · ${DOT_TITLE[r().dot]}`}
      onClick={onRowClick}
    >
      <Show
        when={mode() === 'editing'}
        fallback={
          <div class={rowCls()}>
            <span class="proj-working-bar" aria-hidden="true" />
            <span class="proj-row-name">{r().display}</span>
            {/* Short mode is 56 px wide — bar + dot + 3 initials would
                overflow it, so there the wrap's `is-stopped` accent bar
                carries the signal on its own. */}
            <Show when={!props.short}>
              <LivenessDot state={r().dot} />
            </Show>
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
                Stop means "cancel every running agent turn on this
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
                into a debug session for review. Read-only. */}
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
            <span
              class="proj-row-prompt"
              title="Removes the project from the daemon's registry and from this cockpit (alias, chat metadata, view state, token). Files on disk are NOT touched."
            >forget?</span>
            <button type="button" class="proj-row-action is-cancel has-label"
              onClick={(e) => { e.stopPropagation(); clearForgetError(r().key); railUiStore.clear(); }}>no</button>
            <button
              type="button"
              class="proj-row-action is-danger has-label"
              title="Unregisters it from the daemon and clears this cockpit's copy. Your files stay where they are."
              onClick={(e) => { e.stopPropagation(); void confirmDelete(); }}
            >{forgetting() ? 'forgetting…' : 'forget'}</button>
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

      {/* AX8 — a refused DELETE must be visible: silently scrubbing local
          state while the daemon still serves the project is how the row
          used to come back a second later with the operator's alias and
          token already gone. */}
      <Show when={forgetErrorFor(r().key)}>
        {(msg) => (
          <div class="px-3 pb-2 text-[10.5px] leading-snug text-red-300 break-words">
            Couldn't forget this project: {msg()}
          </div>
        )}
      </Show>
    </div>
  );
}
