/**
 * ProjectsRailRow — one row in the projects rail.
 *
 * Two render modes: view (button) and edit (div + input). Drag-reorder
 * lives on the row button so the .proj-actions overlay (a sibling
 * inside `.proj-row-wrap`) doesn't get its clicks eaten by Chrome's
 * HTML5 drag subsystem.
 *
 * Action buttons + delete-confirm strip live in their own files
 * (RowActions, RowConfirmStrip) so this file stays focused on row
 * layout and the rename signal.
 */

import { Show, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { projectsStore } from '~/state/projects';
import * as kp from '~/lib/known-projects';
import RowActions from '~/components/projects-rail/RowActions';
import RowConfirmStrip from '~/components/projects-rail/RowConfirmStrip';

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
  pendingReview?: boolean;
};

export async function stopProject(port: number, base: string, onAfter: () => void): Promise<void> {
  if (!confirm(`Stop the daemon on port ${port}?\n\nThis terminates the daemon and every agent it spawned on this machine. No signal is sent to the cluster.`)) return;
  const activePort = daemonStore.state.health?.port ?? null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (port === activePort) {
    const t = daemonStore.state.client?.transport.token;
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }
  try {
    await fetch(`${base}/shutdown`, { method: 'POST', headers });
  } catch {
    /* daemon already exiting */
  }
  setTimeout(onAfter, 600);
}

export async function switchProject(port: number, key: string): Promise<void> {
  projectsStore.clearNewBadge(key);
  try { localStorage.setItem('meshcore-last-port', String(port)); } catch { /* quota */ }
  await daemonStore.switchToPort(port);
}

function forgetProjectImmediate(target: { cluster_id?: string | null; port: number }, onAfter: () => void): void {
  kp.forget({ cluster_id: target.cluster_id ?? undefined, port: target.port });
  projectsStore.refresh();
  onAfter();
}

export interface ProjectsRailRowProps {
  row: RailRowData;
  short: boolean;
  onAfterStop: () => void;
  onDragStart?: (key: string) => void;
  onDragOver?: (key: string, e: DragEvent) => void;
  onDrop?: (key: string, e: DragEvent) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  dragOver?: boolean;
}

export default function ProjectsRailRow(props: ProjectsRailRowProps) {
  const [editing, setEditing] = createSignal(false);
  const [val, setVal] = createSignal(props.row.display);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const r = () => props.row;

  const commit = (save: boolean): void => {
    if (save) {
      const k: kp.KnownProject = {
        port: r().port,
        base: r().base,
        last_seen: new Date().toISOString(),
        cluster_id: r().cluster_id ?? undefined,
      };
      kp.setAlias(k, val().trim());
      projectsStore.refresh();
    }
    setEditing(false);
  };

  const wrapCls = (): string => {
    const cls = ['proj-row-wrap'];
    if (!r().live) cls.push('is-stopped');
    if (r().isNew) cls.push('is-new');
    if (props.dragging) cls.push('is-dragging');
    if (props.dragOver) cls.push('is-drag-over');
    return cls.join(' ');
  };

  const rowCls = (): string => {
    const cls = ['proj-row'];
    if (r().active) cls.push('active');
    if (r().working) cls.push('is-working');
    if (r().pendingReview) cls.push('is-pending-review');
    return cls.join(' ');
  };

  // V84 — Click is owned by the WRAP, not by an inner <button>. Two
  // earlier rounds wrapping the row in a draggable <button> kept eating
  // the .proj-actions clicks no matter how many stopPropagation /
  // preventDefault handlers we added (Chrome's HTML5 drag intercepts
  // child mouse events on draggable=true elements in ways CSS sibling
  // overlays can't reliably escape). Solution: the row body is a
  // plain <div>, and the wrap's onClick checks `event.target.closest`
  // for the actions / confirm strip / edit input before navigating.
  const onWrapClick = (e: MouseEvent): void => {
    if (editing()) return;
    const t = e.target as HTMLElement | null;
    if (t && t.closest('.proj-actions, .proj-row-confirm, .proj-row-name--editing')) return;
    void switchProject(r().port, r().key);
  };

  return (
    <div
      class={wrapCls()}
      title={`${r().display} · :${r().port}${r().cluster_id ? ' · ' + r().cluster_id : ''}${!r().live ? ' · stopped' : ''}`}
      onClick={onWrapClick}
      onDragOver={(e) => {
        if (editing() || props.short) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        props.onDragOver?.(r().key, e);
      }}
      onDrop={(e) => {
        if (editing() || props.short) return;
        e.preventDefault();
        props.onDrop?.(r().key, e);
      }}
    >
      <Show
        when={editing()}
        fallback={
          <div
            class={rowCls()}
            draggable={!props.short}
            onDragStart={(e) => {
              if (props.short) { e.preventDefault(); return; }
              e.dataTransfer?.setData('text/plain', r().key);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              props.onDragStart?.(r().key);
            }}
            onDragEnd={() => props.onDragEnd?.()}
          >
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
            value={val()}
            autofocus
            onInput={(e) => setVal(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(true); }
              else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
            }}
            onBlur={() => commit(true)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </Show>
      <Show when={!props.short && !editing() && !confirmingDelete()}>
        <RowActions
          live={r().live}
          port={r().port}
          base={r().base}
          onAfterStop={props.onAfterStop}
          onEdit={() => { setVal(r().display); setConfirmingDelete(false); setEditing(true); }}
          onDelete={() => { setEditing(false); setConfirmingDelete(true); }}
        />
      </Show>
      <Show when={confirmingDelete()}>
        <RowConfirmStrip
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            forgetProjectImmediate({ cluster_id: r().cluster_id, port: r().port }, props.onAfterStop);
          }}
        />
      </Show>
    </div>
  );
}
