/**
 * state/rail-ui.ts — hoisted UI state for the Projects Rail.
 *
 * Why this exists: ProjectsRailRow originally held its `mode`
 * (idle/editing/confirm-delete/confirm-stop-all) and `nameDraft` in
 * local `createSignal`s. But the rail's parent `<For>` reconciles by
 * value identity, and `rows()` returns NEW objects every time any of
 * its store dependencies tick (chatStore.clusterActivity, WS state,
 * etc.). On every such tick `<For>` swaps the component instance and
 * the local signals reset to 'idle' — the operator saw their click
 * log to console but the row never visibly switched into editing or
 * delete-confirm mode.
 *
 * The fix: park the per-row UI state in a module-level store keyed by
 * row.key. Component remounts now read the same state back. Single
 * source of truth means at most ONE row can be in editing or
 * confirm-delete mode at a time, which also matches the operator's
 * mental model — you can't be renaming two projects at once.
 */

import { createStore } from 'solid-js/store';

export type RailRowMode = 'idle' | 'editing' | 'confirm-delete' | 'confirm-stop-all';

interface RailUiState {
  /** Key of the row currently in `editing` mode, or null. */
  editingKey: string | null;
  /** Key of the row currently in `confirm-delete` mode, or null. */
  deleteConfirmKey: string | null;
  /** Key of the row currently in `confirm-stop-all` mode, or null. */
  stopConfirmKey: string | null;
  /** Operator's draft for the currently-edited row's display name. */
  draftName: string;
}

const [state, setState] = createStore<RailUiState>({
  editingKey: null,
  deleteConfirmKey: null,
  stopConfirmKey: null,
  draftName: '',
});

function modeFor(key: string): RailRowMode {
  if (state.editingKey === key) return 'editing';
  if (state.deleteConfirmKey === key) return 'confirm-delete';
  if (state.stopConfirmKey === key) return 'confirm-stop-all';
  return 'idle';
}

function beginEdit(key: string, currentDisplay: string): void {
  setState({
    editingKey: key,
    deleteConfirmKey: null,
    stopConfirmKey: null,
    draftName: currentDisplay,
  });
}

function setDraft(value: string): void {
  setState('draftName', value);
}

function beginConfirmDelete(key: string): void {
  setState({
    editingKey: null,
    deleteConfirmKey: key,
    stopConfirmKey: null,
  });
}

function beginConfirmStop(key: string): void {
  setState({
    editingKey: null,
    deleteConfirmKey: null,
    stopConfirmKey: key,
  });
}

function clear(): void {
  setState({
    editingKey: null,
    deleteConfirmKey: null,
    stopConfirmKey: null,
    draftName: '',
  });
}

export const railUiStore = {
  state,
  modeFor,
  beginEdit,
  setDraft,
  beginConfirmDelete,
  beginConfirmStop,
  clear,
};
