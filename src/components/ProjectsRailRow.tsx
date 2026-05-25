/** ProjectsRailRow — one row in the projects rail: switch, rename, stop. */

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
};

export async function stopProject(port: number, base: string, onAfter: () => void): Promise<void> {
  if (!confirm(`Stop the daemon on port ${port}?\n\nThis terminates the daemon and every agent it spawned on this machine. No signal is sent to the cluster.`)) return;
  const activePort = daemonStore.state.health?.port ?? null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (port === activePort) {
    const t = daemonStore.state.client?.transport.token;
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }
  try { await fetch(`${base}/shutdown`, { method: 'POST', headers }); } catch { /* daemon already exiting */ }
  setTimeout(onAfter, 600);
}

export function switchProject(port: number, key: string): void {
  projectsStore.clearNewBadge(key);
  try { localStorage.setItem('meshcore-last-port', String(port)); } catch { /* quota */ }
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
      const k: kp.KnownProject = { port: r().port, base: r().base, last_seen: new Date().toISOString(), cluster_id: r().cluster_id ?? undefined };
      kp.setAlias(k, val().trim());
      projectsStore.refresh();
    }
    setEditing(false);
  };
  return (
    <div class={`group relative flex items-center gap-1.5 px-1.5 py-1 rounded ${r().active ? 'bg-emerald-500/10 border border-emerald-500/30' : 'border border-transparent hover:bg-gray-900/60'} ${r().isNew ? 'ring-1 ring-emerald-400/60 ring-offset-1 ring-offset-gray-950' : ''}`} title={`${r().display} · :${r().port}${r().cluster_id ? ' · ' + r().cluster_id : ''}${!r().live ? ' · stopped' : ''}`}>
      <button type="button" class="flex items-center gap-1.5 flex-1 min-w-0 text-left" onClick={() => { if (!editing()) switchProject(r().port, r().key); }}>
        <span class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r().live ? (r().active ? 'bg-emerald-400' : 'bg-gray-400') : 'bg-gray-700'}`} />
        <Show when={!props.short && !editing()}>
          <span class={`text-[12px] truncate ${r().active ? 'text-emerald-200 font-semibold' : 'text-gray-300'} ${!r().live ? 'italic text-gray-500' : ''}`}>{r().display}</span>
        </Show>
        <Show when={!props.short && editing()}>
          <input class="flex-1 min-w-0 bg-gray-950 border border-blue-500/50 rounded px-1 py-0 text-[12px] text-gray-100" value={val()} autofocus
            onInput={(e) => setVal(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(true); else if (e.key === 'Escape') commit(false); }}
            onBlur={() => commit(true)} onClick={(e) => e.stopPropagation()} />
        </Show>
        <Show when={props.short}>
          <span class={`text-[10px] font-mono tracking-tight ${r().active ? 'text-emerald-300' : 'text-gray-400'}`}>{r().initials}</span>
        </Show>
      </button>
      <Show when={!props.short && !editing()}>
        <div class="hidden group-hover:flex items-center gap-1">
          <button type="button" class="p-0.5 text-gray-500 hover:text-gray-200" title="Rename" onClick={(e) => { e.stopPropagation(); setVal(r().display); setEditing(true); }}>
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </button>
          <Show when={r().live}>
            <button type="button" class="p-0.5 text-gray-500 hover:text-red-400" title="Stop daemon" onClick={(e) => { e.stopPropagation(); void stopProject(r().port, r().base, props.onAfterStop); }}>
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
