/**
 * RailEmptyPanel — V86c.
 *
 * Rendered inside the cockpit body when:
 *   - no live daemon is the `activeId`, AND
 *   - no `offlineSelection` is parked,
 *
 * i.e. the operator deleted the last selected project or hasn't picked
 * one yet. Two variants driven by how many rows the rail currently has:
 *
 *   - **0 rows** → the operator has nothing to pick. Lead with the
 *     same two actions that live in the rail footer (add a project /
 *     scan ports) but rendered large and centered so a new operator
 *     can't miss them.
 *
 *   - **2+ rows** → the operator has projects, just none selected.
 *     Tell them to pick one from the left column. No CTAs — the row
 *     itself is the action.
 *
 * The **1 row** case is handled upstream in `App.tsx` (auto-selects
 * the lone project), so this panel never renders with one row.
 */

import { Show, createMemo } from 'solid-js';
import { rows } from '~/components/projects-rail/rows';
import { openAddProjectWizard } from '~/components/modals/AddProjectWizard';
import { discoverProjects, scanning, setScanning } from '~/components/projects-rail/discovery';

export default function RailEmptyPanel() {
  const count = createMemo(() => rows().length);

  const onScan = async (): Promise<void> => {
    if (scanning()) return;
    setScanning(true);
    try {
      await discoverProjects({ fullScan: true });
    } finally {
      setScanning(false);
    }
  };

  return (
    <section class="rail-empty-panel">
      <div class="rail-empty-panel__inner">
        <Show
          when={count() === 0}
          fallback={
            <>
              <h2 class="rail-empty-panel__title">Select a project</h2>
              <p class="rail-empty-panel__hint">
                Pick one from the left column to load its cockpit. Each
                row carries an edit/delete pair underneath once it's
                selected.
              </p>
            </>
          }
        >
          <h2 class="rail-empty-panel__title">No projects yet</h2>
          <p class="rail-empty-panel__hint">
            Add a project so the architect can talk to its daemon, or
            scan localhost ports <code>5570–5589</code> if a daemon is
            already running.
          </p>
          <div class="rail-empty-panel__actions">
            <button
              type="button"
              class="rail-empty-panel__btn is-primary"
              onClick={openAddProjectWizard}
            >
              <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" fill="none" width="14" height="14">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Add a project</span>
            </button>
            <button
              type="button"
              class="rail-empty-panel__btn"
              disabled={scanning()}
              onClick={() => void onScan()}
            >
              <Show
                when={!scanning()}
                fallback={
                  <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" fill="none" width="14" height="14">
                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                  </svg>
                }
              >
                <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" width="14" height="14">
                  <path d="M4 4v6h6M20 20v-6h-6M5 13a8 8 0 1014.5-3.5" />
                </svg>
              </Show>
              <span>{scanning() ? 'scanning…' : 'Scan ports'}</span>
            </button>
          </div>
        </Show>
      </div>
    </section>
  );
}
