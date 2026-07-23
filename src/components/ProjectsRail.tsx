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

import { For, Show, createMemo, createEffect, onCleanup, onMount, untrack } from 'solid-js';
import { uiStore } from '~/state/ui';
import ProjectsRailRow from '~/components/ProjectsRailRow';
import { PORT_LO, PORT_HI, discoverProjects, scanning, setScanning } from '~/components/projects-rail/discovery';
import { rows } from '~/components/projects-rail/rows';
import { RailFooter } from '~/components/projects-rail/RailFooter';
import { loadProjectsOrder, applyOrder } from '~/components/projects-rail/order';

export { discoverProjects } from '~/components/projects-rail/discovery';
export { projectsRailScan } from '~/components/projects-rail/discovery';

const RAIL_MIN_W = 56;
const RAIL_MAX_W = 280;
const SHORT_THRESHOLD = 100;

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
  // FC-2 (daemon-centralized) — ONE daemon serves MANY projects, so the boot
  // MUST enumerate them via /projects, or the rail shows only the single
  // boot-attached project. This is now CHEAP: the priority probe set is mostly
  // just the connected daemon's port, and each probe expands to its /projects
  // list (not an N-port sweep). V86e removed boot discovery for the old
  // per-port model; re-added here for the central model.
  onMount(() => { void discoverProjects(); });

  // Onboarding "Watching for your daemon" loop (re-added 2026-06-24).
  // NewPromptScreen flips `scanning()` ON when the operator is about to
  // launch a brand-new daemon. The catch: a fresh cluster binds ANY free
  // port in 5570–5589 (rarely 5570 — sticky ports + other clusters take the
  // low ones) and is NOT yet a known project, so the cheap default probe set
  // (5570 + last-port + known) can NEVER see it. The continuous poll behind
  // this flag had been removed (V86e), so the "Watching…" panel showed a
  // spinner that never actually probed — the new project never popped into
  // the rail until the operator hit Rescan by hand (field report 2026-06-24).
  // Fix: while scanning is on, run a bounded FULL sweep every few seconds so
  // the new daemon is found by itself. Capped so it can't sweep forever if
  // the panel is left open ("Close — keep scanning"). Stop() ends it early.
  createEffect(() => {
    if (!scanning()) return;
    let stopped = false;
    let inFlight = false;
    const startedAt = Date.now();
    const MAX_MS = 3 * 60_000; // safety cap — generous enough to paste + launch
    // CRITICAL: `discoverProjects` READS reactive state (kp.list()) and later
    // MUTATES it (kp.forget prunes ghosts) + writes livePorts/liveClusters/the
    // projects store. If it runs inside this effect's tracking scope, those
    // writes re-schedule THIS effect → it ticks again → writes again → an
    // unbounded reactive flush that overflows the stack ("Maximum call stack
    // size exceeded", field 2026-07-09). `untrack` severs the dependency so the
    // effect depends ONLY on `scanning()`. `inFlight` also coalesces overlapping
    // ticks (the 3.5s interval must never stack a second full sweep on a slow one).
    const tick = async (): Promise<void> => {
      if (stopped || inFlight) return;
      inFlight = true;
      try { await discoverProjects({ fullScan: true }); } catch { /* probe errors are normal */ }
      finally { inFlight = false; }
      if (!stopped && Date.now() - startedAt > MAX_MS) setScanning(false);
    };
    void untrack(() => tick()); // probe immediately, then on an interval
    const id = setInterval(() => void untrack(() => tick()), 3500);
    onCleanup(() => { stopped = true; clearInterval(id); });
  });

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

  // 2026-06-12 — Toggle button removed (the rail is drag-resizable;
  // the explicit << / >> button was redundant chrome). The `toggle`
  // helper is gone too.

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
