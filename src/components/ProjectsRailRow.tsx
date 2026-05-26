/**
 * ProjectsRailRow — one row in the projects rail (V80 1:1 + V81 hot-swap).
 *
 * Two render modes:
 *   - view  → button row with hover-overlay actions (rename · stop · delete).
 *   - edit  → div row with a real `<input>` (NOT nested inside a button so
 *             focus + keyboard input behave correctly — the prior version
 *             nested input-in-button which broke rename in Chrome).
 *
 * Actions:
 *   - Click row  → hot-swap to that project (no full page reload).
 *   - Pencil     → enter rename mode; commit on Enter / blur, abort on Esc.
 *   - Stop       → daemon shutdown (only for live daemons).
 *   - Trash      → confirm + forget. Forgets locally; doesn't kill the daemon.
 *
 * Drag-reorder lives at the rail level (ProjectsRail.tsx) so the row only
 * exposes the conventional HTML5 drag-and-drop attributes + callbacks.
 *
 * State modifiers on the wrap / row drive V80 CSS:
 *   .active           → emerald accent + filled background
 *   .is-working       → bouncing slug in the activity bar
 *   .is-pending-review → amber dashed activity bar
 *   .proj-row-wrap.is-stopped → dim blue accent
 *   .proj-row-wrap.is-new → pulsing NEW badge (cleared on click)
 */

import { Show, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { projectsStore } from '~/state/projects';
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

/** Hot-swap to another project — no page reload (V81). Triggers the
 *  daemonStore reconnect path so the WS, server snapshot and chat
 *  cluster binding all re-hydrate against the new daemon. */
export async function switchProject(port: number, key: string): Promise<void> {
  projectsStore.clearNewBadge(key);
  try {
    localStorage.setItem('meshcore-last-port', String(port));
  } catch {
    /* quota */
  }
  await daemonStore.switchToPort(port);
}

/** Forget a project from the rail. Asks for confirmation. Doesn't kill
 *  the daemon — use stopProject for that. */
async function forgetProject(target: { cluster_id?: string | null; port: number }, display: string, onAfter: () => void): Promise<void> {
  if (!confirm(`Remove "${display}" from the projects rail?\n\nThis only forgets it locally. The daemon (if running) keeps running. You can re-add the project later by re-scanning ports or pasting its token.`)) return;
  kp.forget({ cluster_id: target.cluster_id ?? undefined, port: target.port });
  projectsStore.refresh();
  onAfter();
}

export interface ProjectsRailRowProps {
  row: RailRowData;
  short: boolean;
  onAfterStop: () => void;
  /** drag-reorder hooks supplied by the parent rail. */
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

  const onRowClick = (): void => {
    if (editing()) return;
    void switchProject(r().port, r().key);
  };

  return (
    <div
      class={wrapCls()}
      title={`${r().display} · :${r().port}${r().cluster_id ? ' · ' + r().cluster_id : ''}${!r().live ? ' · stopped' : ''}`}
      draggable={!editing() && !props.short}
      onDragStart={(e) => {
        if (editing() || props.short) { e.preventDefault(); return; }
        e.dataTransfer?.setData('text/plain', r().key);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        props.onDragStart?.(r().key);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        props.onDragOver?.(r().key, e);
      }}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop?.(r().key, e);
      }}
      onDragEnd={() => props.onDragEnd?.()}
    >
      <Show
        when={editing()}
        fallback={
          <button type="button" class={rowCls()} onClick={onRowClick}>
            <span class="proj-working-bar" aria-hidden="true" />
            <span class="proj-row-name">{r().display}</span>
            <span class="proj-row-initials">{r().initials}</span>
          </button>
        }
      >
        {/* Edit mode — no nested input-in-button. The row becomes a
            <div> so focus + keyboard events flow to the <input>
            normally. */}
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
      <Show when={!props.short && !editing()}>
        <div class="proj-actions">
          <button
            type="button"
            class="proj-action is-edit"
            title="Rename"
            onClick={(e) => {
              e.stopPropagation();
              setVal(r().display);
              setEditing(true);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <Show when={r().live}>
            <button
              type="button"
              class="proj-action is-stop"
              title="Stop daemon"
              onClick={(e) => {
                e.stopPropagation();
                void stopProject(r().port, r().base, props.onAfterStop);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            </button>
          </Show>
          <button
            type="button"
            class="proj-action is-delete"
            title="Forget project (remove from rail)"
            onClick={(e) => {
              e.stopPropagation();
              void forgetProject({ cluster_id: r().cluster_id, port: r().port }, r().display, props.onAfterStop);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </button>
        </div>
      </Show>
    </div>
  );
}
