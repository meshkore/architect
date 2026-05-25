import { For, Show, createEffect, onCleanup, onMount } from 'solid-js';
import { uiStore } from '~/state/ui';
import ProjectsRailRow from '~/components/ProjectsRailRow';
import { PORT_LO, PORT_HI, discoverProjects, scanning } from '~/components/projects-rail/discovery';
import { rows } from '~/components/projects-rail/rows';
import { RailFooter, ScanIndicator } from '~/components/projects-rail/RailFooter';

export { discoverProjects } from '~/components/projects-rail/discovery';
export { projectsRailScan } from '~/components/projects-rail/discovery';

const SCAN_INTERVAL_MS = 2500;
const RAIL_MIN_W = 40;
const RAIL_MAX_W = 360;
const SHORT_THRESHOLD = 100;

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
    // dynamic: width is a live signal driven by the drag-resize handler
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
