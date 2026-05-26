/**
 * ProjectsRail — leftmost column (V80 1:1).
 *
 * Two modes driven by `data-mode`:
 *   - "full"  → 180 px, project names + add-project / rescan labels.
 *   - "short" → 56 px, 3-letter initial pills + icon-only footer.
 * The mode is computed from `uiStore.projectsRailWidth` and persisted
 * to localStorage by uiStore. Drag handle on the right edge resizes
 * between RAIL_MIN_W and RAIL_MAX_W.
 *
 * Structure (matches V80 monolith line-for-line):
 *   <aside.projects-rail data-mode="…">
 *     <div.projects-rail-resize />            ← 4 px drag handle
 *     <div.projects-rail-head>
 *       <span.projects-rail-title>Projects</span>
 *       <button.projects-rail-btn>(« or »)</button>
 *     </div>
 *     <div.projects-rail-list>
 *       <ProjectsRailRow … />…
 *     </div>
 *     <RailFooter />                          ← add project + rescan
 *   </aside>
 *
 * Styling lives entirely in src/styles/projects-rail.css.
 */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { uiStore } from '~/state/ui';
import ProjectsRailRow from '~/components/ProjectsRailRow';
import { PORT_LO, PORT_HI, discoverProjects, scanning } from '~/components/projects-rail/discovery';
import { rows } from '~/components/projects-rail/rows';
import { RailFooter } from '~/components/projects-rail/RailFooter';
import { loadProjectsOrder, saveProjectsOrder, applyOrder } from '~/components/projects-rail/order';

export { discoverProjects } from '~/components/projects-rail/discovery';
export { projectsRailScan } from '~/components/projects-rail/discovery';

const SCAN_INTERVAL_MS = 2500;
const RAIL_MIN_W = 56;
const RAIL_MAX_W = 280;
const SHORT_THRESHOLD = 100;
const FULL_W = 180;
const SHORT_W = 56;

export default function ProjectsRail() {
  const width = () => uiStore.state.projectsRailWidth;
  const mode = (): 'full' | 'short' => (width() < SHORT_THRESHOLD ? 'short' : 'full');

  // V82 — drag-reorder state. `order` is the operator-saved sequence;
  // `dragSrc` / `dragOver` track the in-flight drag so rows can render
  // their .is-dragging / .is-drag-over modifiers.
  const [order, setOrder] = createSignal<string[]>(loadProjectsOrder());
  const [dragSrc, setDragSrc] = createSignal<string | null>(null);
  const [dragOver, setDragOver] = createSignal<string | null>(null);
  const orderedRows = createMemo(() => applyOrder(rows(), order()));

  const handleDragStart = (key: string): void => { setDragSrc(key); };
  const handleDragOver = (targetKey: string): void => {
    if (dragSrc() && dragSrc() !== targetKey) setDragOver(targetKey);
  };
  const handleDrop = (targetKey: string): void => {
    const src = dragSrc();
    if (!src || src === targetKey) { setDragSrc(null); setDragOver(null); return; }
    const current = orderedRows().map((r) => r.key);
    const srcIdx = current.indexOf(src);
    const tgtIdx = current.indexOf(targetKey);
    if (srcIdx < 0 || tgtIdx < 0) { setDragSrc(null); setDragOver(null); return; }
    const next = current.slice();
    next.splice(srcIdx, 1);
    next.splice(tgtIdx, 0, src);
    setOrder(next);
    saveProjectsOrder(next);
    setDragSrc(null);
    setDragOver(null);
  };
  const handleDragEnd = (): void => { setDragSrc(null); setDragOver(null); };

  onMount(() => {
    void discoverProjects();
  });

  // Continuous scan timer — only ticks while uiStore says scanning.
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  const stopScanTimer = (): void => {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
  };
  createEffect(() => {
    stopScanTimer();
    if (!scanning()) return;
    scanTimer = setInterval(() => void discoverProjects({ fullScan: true }), SCAN_INTERVAL_MS);
  });
  onCleanup(stopScanTimer);

  // Drag-resize handle on the right edge.
  let host: HTMLElement | undefined;
  const onResizeDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !host) return;
    e.preventDefault();
    document.body.classList.add('col-reordering');
    const startX = e.clientX;
    const startW = host.getBoundingClientRect().width;
    const onMove = (ev: PointerEvent): void => {
      const w = Math.max(RAIL_MIN_W, Math.min(RAIL_MAX_W, Math.round(startW + (ev.clientX - startX))));
      uiStore.setProjectsRailWidth(w);
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('col-reordering');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Toggle between the two canonical widths.
  const toggle = (): void => {
    uiStore.setProjectsRailWidth(mode() === 'short' ? FULL_W : SHORT_W);
  };

  return (
    <aside
      ref={(el) => (host = el)}
      class="projects-rail"
      data-mode={mode()}
      aria-label="Open projects on this machine"
    >
      <div class="projects-rail-resize" onPointerDown={onResizeDown} title="Drag to resize" />
      <div class="projects-rail-head">
        <span class="projects-rail-title">Projects</span>
        <button type="button" class="projects-rail-btn" onClick={toggle} title="Toggle rail width">
          <svg class="rail-icon-collapse" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14">
            <path d="M11 5l-7 7 7 7M20 5l-7 7 7 7" />
          </svg>
          <svg class="rail-icon-expand" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14">
            <path d="M13 5l7 7-7 7M4 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div class="projects-rail-list">
        <Show
          when={rows().length > 0}
          fallback={
            <Show when={mode() === 'full'}>
              <div class="projects-rail-empty">
                No daemons on :{PORT_LO}–{PORT_HI}. Start{' '}
                <code class="font-mono" style={{ color: 'var(--text-strong)' }}>meshcore start</code>{' '}
                in any <code class="font-mono">.meshkore/</code> repo.
              </div>
            </Show>
          }
        >
          <For each={orderedRows()}>
            {(r) => (
              <ProjectsRailRow
                row={r}
                short={mode() === 'short'}
                onAfterStop={() => void discoverProjects()}
                onDragStart={handleDragStart}
                onDragOver={(key) => handleDragOver(key)}
                onDrop={(key) => handleDrop(key)}
                onDragEnd={handleDragEnd}
                dragging={dragSrc() === r.key}
                dragOver={dragOver() === r.key}
              />
            )}
          </For>
        </Show>
      </div>
      <RailFooter short={mode() === 'short'} />
    </aside>
  );
}
