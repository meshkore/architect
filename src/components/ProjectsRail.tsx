/**
 * ProjectsRail — pinned leftmost column. Lists every meshcore daemon
 * known to this browser (live + stopped) and lets the operator switch
 * between projects, rename, stop, rescan, and add a new one.
 *
 * V79o rule: known entries NEVER auto-disappear from this rail. A known
 * record is suppressed from display only when (a) the same cluster_id is
 * live elsewhere or (b) the entry has no cluster_id AND its port is
 * occupied by a live daemon. Port collision alone never suppresses.
 *
 * Discovery probes 5570–5589 with /health. Pass-1 hits priority ports
 * (5570 + last-used + every known); pass-2 fans out to the full range
 * whenever a known cluster_id is still missing or fullScan is forced.
 */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { projectsStore } from '~/state/projects';
import { uiStore } from '~/state/ui';
import * as kp from '~/lib/known-projects';
import { log } from '~/lib/log';
import ProjectsRailRow, { type RailRowData } from '~/components/ProjectsRailRow';
import { openAddProjectWizard } from '~/components/modals/AddProjectWizard';

const PORT_LO = 5570;
const PORT_HI = 5589;
const PROBE_TIMEOUT_MS = 500;
const SCAN_INTERVAL_MS = 2500;
const RAIL_MIN_W = 40;
const RAIL_MAX_W = 360;
const SHORT_THRESHOLD = 100;

type LiveProbe = { port: number; base: string; cluster_id: string | null; cluster_name: string | null };

const [livePorts, setLivePorts] = createSignal<Set<number>>(new Set());
const [liveClusters, setLiveClusters] = createSignal<Map<string, LiveProbe>>(new Map());
const [scanning, setScanning] = createSignal(false);
const [rescanBusy, setRescanBusy] = createSignal(false);

async function probe(port: number): Promise<LiveProbe | null> {
  try {
    const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!r.ok) return null;
    const data = await r.json().catch(() => ({})) as { cluster_id?: string; cluster_name?: string };
    return { port, base: `http://localhost:${port}`, cluster_id: data.cluster_id ?? null, cluster_name: data.cluster_name ?? null };
  } catch { return null; }
}

export async function discoverProjects(opts: { fullScan?: boolean } = {}): Promise<void> {
  const known = kp.list();
  const priority = new Set<number>([5570]);
  const last = parseInt(localStorage.getItem('meshcore-last-port') || '0', 10);
  if (last >= PORT_LO && last <= PORT_HI) priority.add(last);
  for (const p of known) priority.add(p.port);
  const pri = [...priority].filter((p) => p >= PORT_LO && p <= PORT_HI);
  const rest: number[] = [];
  for (let p = PORT_LO; p <= PORT_HI; p++) if (!priority.has(p)) rest.push(p);

  let live = (await Promise.all(pri.map(probe))).filter((x): x is LiveProbe => !!x);
  const knownIds = known.map((k) => k.cluster_id).filter((x): x is string => !!x);
  const seenIds = new Set(live.map((l) => l.cluster_id).filter((x): x is string => !!x));
  const missing = knownIds.some((id) => !seenIds.has(id));
  if (opts.fullScan || missing || !live.length) {
    const more = (await Promise.all(rest.map(probe))).filter((x): x is LiveProbe => !!x);
    live = live.concat(more);
  }

  const portSet = new Set(live.map((l) => l.port));
  const clusterMap = new Map<string, LiveProbe>();
  for (const l of live) {
    if (l.cluster_id) clusterMap.set(l.cluster_id, l);
    projectsStore.upsert({
      port: l.port, base: l.base,
      cluster_id: l.cluster_id ?? undefined,
      cluster_name: l.cluster_name ?? undefined,
      status: 'live',
    });
  }
  setLivePorts(portSet);
  setLiveClusters(clusterMap);
  log.debug('discover · live', live.length, 'known', known.length);
}

function initialsFor(name: string): string {
  const words = name.replace(/[^A-Za-z0-9\s\-_]/g, ' ').split(/[\s\-_]+/).filter(Boolean);
  let out: string;
  if (words.length >= 3) out = words.slice(0, 3).map((w) => w[0]).join('');
  else if (words.length === 2) out = (words[0]?.[0] ?? '') + (words[0]?.slice(1, 2) ?? '') + (words[1]?.[0] ?? '');
  else out = (words[0] ?? '').slice(0, 3);
  return out.toUpperCase().padEnd(3, '·').slice(0, 3);
}

const rows = createMemo<RailRowData[]>(() => {
  const known = projectsStore.state.list;
  const livePortSet = livePorts();
  const liveById = liveClusters();
  const activePort = daemonStore.state.health?.port ?? null;
  const newIds = new Set(projectsStore.state.newClusterIds);
  const result: RailRowData[] = [];
  const seenPorts = new Set<number>();
  const seenClusters = new Set<string>();
  for (const k of known) {
    const liveProbe = k.cluster_id ? liveById.get(k.cluster_id) : null;
    const isLive = !!liveProbe || (!k.cluster_id && livePortSet.has(k.port));
    if (!isLive) {
      if (k.cluster_id && liveById.has(k.cluster_id)) continue;
      if (!k.cluster_id && livePortSet.has(k.port)) continue;
    }
    const port = liveProbe?.port ?? k.port;
    if (seenPorts.has(port)) continue;
    if (k.cluster_id && seenClusters.has(k.cluster_id)) continue;
    seenPorts.add(port);
    if (k.cluster_id) seenClusters.add(k.cluster_id);
    const alias = kp.getAlias(k);
    const display = alias || k.cluster_name || k.cluster_id || `:${port}`;
    result.push({
      key: k.cluster_id ?? `port:${port}`,
      port, base: liveProbe?.base ?? k.base,
      cluster_id: k.cluster_id ?? null,
      cluster_name: k.cluster_name ?? null,
      display, initials: initialsFor(display),
      live: isLive,
      active: isLive && port === activePort,
      isNew: newIds.has(k.cluster_id ?? `port:${port}`),
    });
  }
  result.sort((a, b) => a.port - b.port);
  return result;
});

function RailFooter(props: { short: boolean }) {
  return (
    <div class="border-t border-gray-800/60 p-1.5 flex flex-col gap-1">
      <button type="button" onClick={openAddProjectWizard}
        class="w-full px-2 py-1.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium hover:bg-emerald-500/25 transition flex items-center justify-center gap-1.5" title="Add another project">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
        <Show when={!props.short}><span>add project</span></Show>
      </button>
      <button type="button" disabled={rescanBusy()}
        onClick={async () => { setRescanBusy(true); try { await discoverProjects({ fullScan: true }); } finally { setRescanBusy(false); } }}
        class="w-full px-2 py-1 rounded text-gray-400 text-[11px] hover:bg-gray-900 hover:text-gray-200 transition flex items-center justify-center gap-1.5 disabled:opacity-50" title="Rescan ports 5570-5589">
        <svg class={`w-3 h-3 ${rescanBusy() ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 019-9 9 9 0 016.5 2.8L21 8M21 3v5h-5M21 12a9 9 0 01-9 9 9 9 0 01-6.5-2.8L3 16M3 21v-5h5" /></svg>
        <Show when={!props.short}><span>rescan</span></Show>
      </button>
    </div>
  );
}

function ScanIndicator(props: { short: boolean }) {
  return (
    <Show when={scanning()}>
      <button type="button" onClick={() => setScanning(false)}
        class="mx-1.5 mb-1.5 px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-mono flex items-center gap-1.5 hover:bg-amber-500/25" title="Stop scanning for new daemons">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <Show when={!props.short}><span class="flex-1 text-left">scanning…</span></Show>
        <Show when={!props.short}><span class="text-amber-200">stop</span></Show>
      </button>
    </Show>
  );
}

export default function ProjectsRail() {
  const width = () => uiStore.state.projectsRailWidth;
  const short = () => width() < SHORT_THRESHOLD;

  onMount(() => { void discoverProjects(); });

  let scanTimer: ReturnType<typeof setInterval> | null = null;
  const stopScanTimer = (): void => { if (scanTimer) { clearInterval(scanTimer); scanTimer = null; } };
  createEffect(() => {
    stopScanTimer();
    if (!scanning()) return;
    scanTimer = setInterval(() => void discoverProjects({ fullScan: true }), SCAN_INTERVAL_MS);
  });
  onCleanup(stopScanTimer);

  let host: HTMLElement | undefined;
  const onResizeDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !host) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = host.getBoundingClientRect().width;
    const onMove = (ev: PointerEvent): void => {
      const w = Math.max(RAIL_MIN_W, Math.min(RAIL_MAX_W, Math.round(startW + (ev.clientX - startX))));
      uiStore.setProjectsRailWidth(w);
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const toggle = (): void => uiStore.setProjectsRailWidth(short() ? 180 : 56);

  return (
    <aside ref={(el) => (host = el)} class="relative flex-shrink-0 bg-gray-950 border-r border-gray-800/60 flex flex-col" style={{ width: `${width()}px` }} aria-label="Open projects on this machine">
      <div class="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-emerald-500/30" onPointerDown={onResizeDown} title="Drag to resize" />
      <div class="flex items-center justify-between px-2 py-1.5 border-b border-gray-800/60">
        <Show when={!short()}><span class="text-[10px] font-mono uppercase tracking-wider text-gray-500">Projects</span></Show>
        <button type="button" onClick={toggle} class="p-0.5 text-gray-500 hover:text-gray-200" title="Toggle rail width">
          <Show when={!short()} fallback={
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 5l7 7-7 7M4 5l7 7-7 7" /></svg>
          }>
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5l-7 7 7 7M20 5l-7 7 7 7" /></svg>
          </Show>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto p-1 flex flex-col gap-0.5">
        <Show when={rows().length > 0} fallback={
          <Show when={!short()}>
            <div class="text-[11px] text-gray-500 p-2 leading-relaxed">No daemons on :{PORT_LO}–{PORT_HI}. Start <code class="font-mono text-emerald-300">meshcore start</code> in any <code class="font-mono">.meshkore/</code> repo.</div>
          </Show>
        }>
          <For each={rows()}>{(r) => <ProjectsRailRow row={r} short={short()} onAfterStop={() => void discoverProjects()} />}</For>
        </Show>
      </div>
      <ScanIndicator short={short()} />
      <RailFooter short={short()} />
    </aside>
  );
}

export const projectsRailScan = {
  start: (): void => { setScanning(true); },
  stop: (): void => { setScanning(false); },
  isScanning: (): boolean => scanning(),
};
