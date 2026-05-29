/**
 * ProjectDebugModal — V103. Pop-up que imprime el estado en memoria
 * del cockpit + el contenido del localStorage relevantes a un
 * proyecto concreto. Existe para que el operador pueda pegárnoslo
 * tal cual y diagnosticar:
 *
 *   "Mira lo que tengo aquí. ¿Esto está bien? ¿Hay algo desfasado?
 *    ¿Estamos ordenando los datos como debemos?"
 *
 * Pestañas:
 *  - **Memory** — un snapshot JSON de cada store reactivo, filtrado
 *    al cluster_id de este proyecto (chatStore slice, storyStore
 *    runs, daemonStore instance, viewStore slice, serverStore
 *    snapshot, projectsStore entry).
 *  - **localStorage** — todas las claves del navegador que pertenecen
 *    a este proyecto (suffix `::<cluster_id>`) + las globales del
 *    cockpit (mc-*, meshcore-*). Cada entrada parseada como JSON si
 *    es JSON, raw si no.
 *
 * Botón "Copy snapshot" arriba a la derecha de cada pestaña — copia
 * el JSON completo al portapapeles, listo para pegárnoslo.
 *
 * Read-only por diseño. No hay botones de "reset" ni "edit" — el
 * objetivo es DIAGNÓSTICO, no mutación. Si tras inspeccionar el
 * snapshot el operador quiere borrar algo, hay otras rutas
 * (forget project, archive, etc.).
 */

import { JSX, Show, createSignal, createMemo } from 'solid-js';
import { Portal } from 'solid-js/web';
import { chatStore } from '~/state/chat';
import { storyStore } from '~/state/story';
import { daemonStore } from '~/state/daemon';
import { viewStore } from '~/state/view';
import { serverStore } from '~/state/server';
import { projectsStore } from '~/state/projects';
import { uiStore } from '~/state/ui';
import { log } from '~/lib/log';

interface DebugTarget {
  port: number;
  cluster_id: string | null;
  display: string;
}

type Tab = 'memory' | 'localStorage';

const [target, setTarget] = createSignal<DebugTarget | null>(null);

export function openProjectDebugModal(t: DebugTarget): void {
  setTarget(t);
}

const closeModal = (): void => { setTarget(null); };

/** Build the in-memory snapshot for a project. Filters every store
 *  to just the cluster_id's slice so 50 projects don't blow up the
 *  dialog. Returns a plain JSON-serialisable object. */
function buildMemorySnapshot(t: DebugTarget): unknown {
  const cid = t.cluster_id ?? `port:${t.port}`;

  // Cluster activity is keyed by cluster_id.
  const activity = chatStore.state.clusterActivity?.[cid];

  // chatStore is per-cluster — but ONLY the currently-active cluster
  // has its slice in `state.convMap` / `state.convMeta` etc. For
  // OTHER clusters, the slice lives in the closure-private
  // `clusterSnapshots` Map (chat.ts) which isn't exposed. We expose
  // what we can: if THIS project is the active one, the full slice;
  // otherwise just convMeta cached in localStorage (read below).
  const isActive = chatStore.state.activeConv !== null
    && daemonStore.state.health?.cluster_id === t.cluster_id;

  // storyStore is multi-cluster aware: runs are tagged by cluster
  // via the daemon's RunStore. For now we just dump runs whose
  // initiative_id lives in THIS project (best effort).
  const runs = storyStore.state.runs;

  // daemonStore instance for this cluster (if attached).
  const inst = Object.values(daemonStore.state.instances).find(
    (i) => i.health.cluster_id === t.cluster_id || (`port:${i.port}` === cid),
  );

  // viewStore is also per-cluster (rebound on bindCluster).
  // We expose its current slice — only meaningful if this is the
  // active project.
  const view = viewStore.state;

  // serverStore.snapshot is also tied to the active cluster.
  const server = serverStore.state.snapshot ?? null;

  // projectsStore entry for this row.
  const projectEntry = (projectsStore.state.list ?? []).find(
    (p) => p.cluster_id === t.cluster_id || p.port === t.port,
  );

  return {
    _summary: {
      cluster_id: t.cluster_id,
      port: t.port,
      display: t.display,
      is_active_in_cockpit: isActive,
      daemon_attached: !!inst,
      daemon_version: inst?.health.version ?? null,
      daemon_outdated: inst?.outdated ?? null,
      daemon_ahead: inst?.ahead ?? null,
      ws_state: inst?.wsState ?? null,
      active_convs_health: inst?.health.chat_active_convs ?? [],
      conv_count_in_memory: isActive ? Object.keys(chatStore.state.convMap).length : null,
      conv_meta_count_in_memory: isActive ? Object.keys(chatStore.state.convMeta).length : null,
      archived_conv_count: isActive ? Object.keys(chatStore.state.archivedConvs).length : null,
      runs_count: runs.length,
      ui_zone: uiStore.state.activeZone,
    },
    daemonStore_instance: inst ? {
      clusterKey: inst.clusterKey,
      port: inst.port,
      wsState: inst.wsState,
      version: inst.version,
      outdated: inst.outdated,
      ahead: inst.ahead,
      supportsSelfUpdate: inst.supportsSelfUpdate,
      health: inst.health,
    } : null,
    chatStore_active_slice: isActive ? {
      activeConv: chatStore.state.activeConv,
      convMeta: chatStore.state.convMeta,
      archivedConvs: chatStore.state.archivedConvs,
      pendingReplyConvs: chatStore.state.pendingReplyConvs,
      lastDeltaTsByConv: chatStore.state.lastDeltaTsByConv,
      agentStatus: chatStore.state.agentStatus,
      convMap_summary: Object.fromEntries(
        Object.entries(chatStore.state.convMap).map(([k, msgs]) => [
          k, { count: msgs.length, lastTs: msgs.at(-1)?.ts ?? null, lastKind: msgs.at(-1)?.kind ?? null },
        ]),
      ),
    } : '(this is not the active project — chatStore slice lives in closure-private snapshot map)',
    clusterActivity: activity ?? null,
    storyStore_runs: runs,
    viewStore_slice: isActive ? view : '(not active — viewStore is per-cluster)',
    serverStore_snapshot_keys: server && typeof server === 'object'
      ? Object.keys(server)
      : null,
    serverStore_active_cluster: projectsStore.state.activeClusterId ?? null,
    projects_rail_entry: projectEntry ?? null,
    uiStore_global: uiStore.state,
  };
}

/** Read every localStorage key that pertains to this project +
 *  every global cockpit key. Parses JSON values where possible. */
function buildLocalStorageSnapshot(t: DebugTarget): unknown {
  const cid = t.cluster_id ?? `port:${t.port}`;
  const result: Record<string, { kind: string; value: unknown; raw_size: number }> = {};
  // Iterate every key; categorise.
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      // V102 — Include keys that are either (a) per-cluster (suffix
      // ::<cluster_id>) or (b) global cockpit (mc-*, meshcore-*).
      // Per-cluster keys for OTHER projects are excluded to keep
      // the snapshot focused.
      const isPerCluster = key.includes('::');
      if (isPerCluster) {
        if (!key.endsWith(`::${cid}`)) continue;
      } else if (!(key.startsWith('mc-') || key.startsWith('meshcore'))) {
        continue;
      }
      const raw = localStorage.getItem(key) ?? '';
      let parsed: unknown = raw;
      let kind = 'string';
      if (raw && (raw.startsWith('{') || raw.startsWith('['))) {
        try { parsed = JSON.parse(raw); kind = 'json'; }
        catch { parsed = raw; kind = 'string-or-corrupt-json'; }
      } else if (raw === 'true' || raw === 'false') {
        parsed = raw === 'true'; kind = 'bool';
      } else if (!Number.isNaN(Number(raw)) && raw.trim() !== '') {
        parsed = Number(raw); kind = 'number';
      }
      result[key] = { kind, value: parsed, raw_size: raw.length };
    }
  } catch (e) {
    log.warn('localStorage snapshot threw', e instanceof Error ? e.message : String(e));
  }
  return {
    _summary: {
      cluster_id: t.cluster_id,
      port: t.port,
      total_keys_for_this_project: Object.keys(result).length,
    },
    keys: result,
  };
}

export function ProjectDebugModalHost(): JSX.Element {
  const [tab, setTab] = createSignal<Tab>('memory');
  const [copyOk, setCopyOk] = createSignal(false);

  const snapshot = createMemo<{ memory: unknown; localStorage: unknown } | null>(() => {
    const t = target();
    if (!t) return null;
    return {
      memory: buildMemorySnapshot(t),
      localStorage: buildLocalStorageSnapshot(t),
    };
  });

  const currentPayload = (): string => {
    const s = snapshot();
    if (!s) return '';
    const obj = tab() === 'memory' ? s.memory : s.localStorage;
    try { return JSON.stringify(obj, null, 2); }
    catch (e) { return `(stringify failed: ${e instanceof Error ? e.message : String(e)})`; }
  };

  const copy = async (): Promise<void> => {
    const text = currentPayload();
    try {
      await navigator.clipboard.writeText(text);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1500);
    } catch (e) {
      log.warn('copy snapshot failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Show when={target()}>
      <Portal mount={document.body}>
        <div
          class="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-[rgba(2,4,12,0.78)] backdrop-blur"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div class="w-full max-w-4xl max-h-[88vh] bg-[#0b1220] border border-gray-700/40 rounded-2xl shadow-2xl grid grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden">
            <header class="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-gray-800/60">
              <div class="flex-1 min-w-0">
                <h2 class="text-base font-semibold text-gray-100 truncate">
                  Project debug — {target()?.display}
                </h2>
                <p class="text-xs text-gray-500 mt-0.5 truncate font-mono">
                  cluster_id={target()?.cluster_id ?? '(none)'} · port={target()?.port}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                class="text-gray-400 hover:text-gray-100 px-2 py-1 rounded transition"
                onClick={closeModal}
              >✕</button>
            </header>

            {/* Tabs */}
            <nav class="flex items-center gap-1 px-5 py-2 border-b border-gray-800/60 bg-gray-950/30">
              <TabPill id="memory"       label="In-memory stores" active={tab() === 'memory'}       onClick={() => setTab('memory')} />
              <TabPill id="localStorage" label="localStorage"      active={tab() === 'localStorage'} onClick={() => setTab('localStorage')} />
              <span class="flex-1" />
              <button
                type="button"
                onClick={() => { void copy(); }}
                class="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border border-emerald-500/40 hover:border-emerald-500/70 text-emerald-200 hover:text-emerald-100 transition-colors"
              >
                {copyOk() ? 'copied ✓' : 'Copy snapshot'}
              </button>
            </nav>

            {/* Body — scrollable JSON */}
            <div class="px-5 py-3 overflow-auto min-h-0 bg-gray-950/40">
              <pre class="text-[11px] leading-relaxed font-mono text-gray-200 whitespace-pre">
                {currentPayload()}
              </pre>
            </div>

            <footer class="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800/60 bg-gray-950/40">
              <p class="text-[10px] text-gray-500 flex-1">
                Read-only diagnostic snapshot. Paste it back to debug session for review.
              </p>
              <button
                type="button"
                onClick={closeModal}
                class="px-3 py-1.5 rounded bg-gray-900 text-gray-300 border border-gray-800 text-sm hover:border-gray-700 transition"
              >Close</button>
            </footer>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

function TabPill(props: { id: Tab; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider transition-colors border ${
        props.active
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
          : 'text-gray-500 hover:text-gray-300 border-transparent hover:border-gray-700'
      }`}
    >
      {props.label}
    </button>
  );
}
