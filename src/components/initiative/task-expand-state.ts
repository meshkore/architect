/**
 * task-expand-state.ts — which task bodies are open, keyed by task id.
 *
 * AX14 (cockpit-excellence). This state is deliberately MODULE-level,
 * not per-row: the cockpit re-polls `/state` every ~2s and the roadmap
 * `<For>` recreates the task rows on each refresh, so a per-component
 * signal reset and the detail auto-collapsed after 2s (operator field
 * report 2026-06-19). A module signal survives the recreation, exactly
 * like the parent panel's `openId`.
 *
 * It also has to outlive the panel: expand-all is triggered from the
 * roadmap header while the rows themselves mount and unmount below it.
 */

import { createRoot, createSignal } from 'solid-js';

const [expandedTaskIds, setExpandedTaskIds] = createRoot(() =>
  createSignal<Set<string>>(new Set()),
);

/** Is this task's inline detail open? Reactive. */
export const isTaskOpen = (id: string): boolean => expandedTaskIds().has(id);

export function toggleTaskOpen(id: string): void {
  const next = new Set(expandedTaskIds());
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setExpandedTaskIds(next);
}

/** Open every listed task body in one shot (the header's expand-all).
 *  Copies into a fresh Set so the signal actually fires. */
export function expandAllTaskRows(ids: Iterable<string>): void {
  setExpandedTaskIds(new Set<string>(ids));
}

/** Collapse every task body. */
export function collapseAllTaskRows(): void {
  setExpandedTaskIds(new Set<string>());
}
