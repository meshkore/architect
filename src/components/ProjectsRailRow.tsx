/**
 * ProjectsRailRow — one row in the projects rail (V80 1:1).
 *
 * Wrapper `.proj-row-wrap` hosts the row + the hover-overlay action
 * buttons. The row itself (`.proj-row`) carries the activity bar,
 * status modifiers, name (or 3-letter initials in short mode), and
 * (for stopped projects) a "START" hint that swaps in for the stop
 * button. State modifiers:
 *   .active           → emerald accent + filled background
 *   .is-working       → bouncing slug in the activity bar
 *   .is-pending-review → amber dashed activity bar
 *   .proj-row-wrap.is-stopped → dim blue accent + START hint
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

export function switchProject(port: number, key: string): void {
  projectsStore.clearNewBadge(key);
  try {
    localStorage.setItem('meshcore-last-port', String(port));
  } catch {
    /* quota */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('host', `localhost:${port}`);
  window.location.href = url.toString();
}

export default function ProjectsRailRow(props: { row: RailRowData; short: boolean; onAfterStop: () => void }) {
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
    switchProject(r().port, r().key);
  };

  return (
    <div
      class={wrapCls()}
      title={`${r().display} · :${r().port}${r().cluster_id ? ' · ' + r().cluster_id : ''}${!r().live ? ' · stopped' : ''}`}
    >
      <button type="button" class={rowCls()} onClick={onRowClick}>
        <span class="proj-working-bar" aria-hidden="true" />
        <Show when={!editing()} fallback={
          <input
            class="proj-row-name"
            value={val()}
            autofocus
            onInput={(e) => setVal(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(true);
              else if (e.key === 'Escape') commit(false);
            }}
            onBlur={() => commit(true)}
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'inherit', font: 'inherit' }}
          />
        }>
          <span class="proj-row-name">{r().display}</span>
        </Show>
        <span class="proj-row-initials">{r().initials}</span>
        <Show when={!r().live}>
          <span class="proj-row-start">start</span>
        </Show>
      </button>
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
        </div>
      </Show>
    </div>
  );
}
