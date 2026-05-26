/**
 * RailFooter — V80 1:1: two stacked .projects-rail-foot-btn buttons.
 *
 *   1. Add project (primary green pill, opens AddProjectWizard).
 *   2. Rescan + scanning-state indicator inside the same button — when
 *      `scanning()` is true, the default icon+label hide and the
 *      spinner + "scanning…" label show (hover → red "stop" hint).
 *
 * The CSS that drives the state swap lives in styles/projects-rail.css
 * (rules like `.projects-rail-foot-btn[data-state="scanning"] ...`).
 */

import { Show } from 'solid-js';
import { openAddProjectWizard } from '~/components/modals/AddProjectWizard';
import { discoverProjects, scanning, setScanning } from './discovery';

export function RailFooter(_props: { short: boolean }) {
  // V80 had a single rescan button that toggles between idle and
  // scanning. Click while idle → run a one-shot full scan AND turn on
  // continuous scan. Click while scanning → stop scan.
  const onRescanClick = (): void => {
    if (scanning()) {
      setScanning(false);
      return;
    }
    setScanning(true);
    void discoverProjects({ fullScan: true });
  };

  return (
    <div class="projects-rail-foot">
      <button
        type="button"
        onClick={openAddProjectWizard}
        class="projects-rail-foot-btn is-primary"
        title="Add another project to this architect"
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" fill="none" width="13" height="13">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span class="projects-rail-foot-label">add project</span>
      </button>

      <button
        type="button"
        onClick={onRescanClick}
        class="projects-rail-foot-btn"
        data-state={scanning() ? 'scanning' : 'idle'}
        title="Rescan for daemons on ports 5570-5589"
      >
        <svg class="rescan-icon-default" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="13" height="13">
          <path d="M4 4v6h6M20 20v-6h-6M5 13a8 8 0 1014.5-3.5" />
        </svg>
        <svg class="rescan-icon-scanning" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" fill="none" width="13" height="13">
          <path d="M21 12a9 9 0 11-6.219-8.56" />
        </svg>
        <span class="projects-rail-foot-label rescan-label-default">rescan</span>
        <span class="projects-rail-foot-label rescan-label-scanning">scanning…</span>
      </button>
    </div>
  );
}

/**
 * ScanIndicator — kept as a no-op shell so existing imports still
 * resolve. V80 folded the indicator INTO the rescan button (see above),
 * so the standalone indicator is no longer rendered.
 */
export function ScanIndicator(_props: { short: boolean }) {
  return <Show when={false}><></></Show>;
}
