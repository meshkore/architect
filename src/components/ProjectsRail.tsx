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

import { For, Show, createMemo } from 'solid-js';
import { uiStore } from '~/state/ui';
import ProjectsRailRow from '~/components/ProjectsRailRow';
import { PORT_LO, PORT_HI, discoverProjects } from '~/components/projects-rail/discovery';
import { rows } from '~/components/projects-rail/rows';
import { RailFooter } from '~/components/projects-rail/RailFooter';
import { loadProjectsOrder, applyOrder } from '~/components/projects-rail/order';

export { discoverProjects } from '~/components/projects-rail/discovery';
export { projectsRailScan } from '~/components/projects-rail/discovery';

const RAIL_MIN_W = 56;
const RAIL_MAX_W = 280;
const SHORT_THRESHOLD = 100;
const FULL_W = 180;
const SHORT_W = 56;

export default function ProjectsRail() {
  const width = () => uiStore.state.projectsRailWidth;
  const mode = (): 'full' | 'short' => (width() < SHORT_THRESHOLD ? 'short' : 'full');

  // V85 — drag-reorder is OFF in this iteration. We still respect
  // the operator-saved order from localStorage so previously-set
  // sequences persist; rebuilding drag with the new layout (no
  // absolute overlay) is a follow-up that needs a dedicated grip
  // handle, not full-row draggable.
  const order = (): string[] => loadProjectsOrder();
  const orderedRows = createMemo(() => applyOrder(rows(), order()));

  // V86e — Boot used to fire `discoverProjects()` here so the rail
  // could decorate each row with a live/stopped pill before the
  // operator clicked anything. The cost was an N-port probe across
  // 5570–5574 on EVERY page load, plus a steady stream of Chrome LNA
  // Issues whenever the daemon wasn't running. The session-pinning
  // info that probe was after (which port is live) already lives in
  // localStorage via `meshcore-last-port` + `kp.list()`. The boot
  // path in `connection.ts` already probes the single last-port and
  // attaches it — no rail-side scan needed.
  //
  // Discovery now runs ONLY on the operator's explicit click:
  //   - "Scan ports" button in `RailEmptyPanel`
  //   - "Rescan" button in `RailFooter`
  // Both call `discoverProjects({ fullScan: true })` which sweeps
  // 5570–5589 once and stops.
  void discoverProjects; // keep the import live for downstream callers

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
              />
            )}
          </For>
        </Show>
      </div>
      <RailFooter short={mode() === 'short'} />
    </aside>
  );
}
