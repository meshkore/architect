/**
 * InitiativeNode — the ● on the timeline, and the archive toggle beside it.
 *
 * The node is the story's run-control, and its glyph IS its affordance:
 *   running → ⏹ stop      done → ✓ (locked, disabled)
 *   backlog → ↑ promote   active → ＋ enqueue / ≡ dequeue
 *
 * `--progress` (0..1) drives the conic-gradient ring around the circle.
 *
 * The archive control uses stroke SVGs, not 🗃 / ↺ emoji: those rendered
 * inconsistently across fonts (operator field report 2026-06-20).
 */

import { Show } from 'solid-js';

export type VisualState = 'active' | 'next' | 'running' | 'backlog' | 'done';

export function InitiativeNode(props: {
  vstate: VisualState;
  /** 0..100 — fraction of the story's tasks that are done. */
  progressPct: number;
  queued: boolean;
  title: string;
  onClick: (e: MouseEvent) => void;
}) {
  /** States where the node is an enqueue/dequeue toggle. */
  const plain = (): boolean =>
    props.vstate !== 'running' && props.vstate !== 'done' && props.vstate !== 'backlog';

  return (
    <button
      type="button"
      class={`rt-node is-${props.vstate}${props.queued && plain() ? ' is-queued' : ''}`}
      style={{ '--progress': String(props.progressPct / 100) }}
      onClick={(e) => props.onClick(e)}
      disabled={props.vstate === 'done'}
      title={props.title}
      aria-label={props.title}
    >
      <Show when={props.vstate === 'running'}>
        <span class="rt-stop" aria-hidden="true" />
      </Show>
      <Show when={props.vstate === 'done'}>
        <svg class="rt-check" viewBox="0 0 24 24" width="12" height="12" fill="none"
          stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      </Show>
      <Show when={props.vstate === 'backlog'}>
        <svg class="rt-promote" viewBox="0 0 24 24" width="13" height="13" fill="none"
          stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 19V6M6 12l6-6 6 6" />
        </svg>
      </Show>
      <Show when={plain() && props.queued}>
        <svg class="rt-queued" viewBox="0 0 24 24" width="13" height="13" fill="none"
          stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </Show>
      <Show when={plain() && !props.queued}>
        <svg class="rt-plus" viewBox="0 0 24 24" width="14" height="14" fill="none"
          stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Show>
    </button>
  );
}

/** Hide/restore the story on the operator's local active list. Fades in
 *  on hover/open (styling lives in .rt-secondary). */
export function ArchiveToggle(props: { archived: boolean; onToggle: (e: MouseEvent) => void }) {
  return (
    <span class="rt-secondary" aria-hidden="false">
      <button
        type="button"
        class="rt-icon-btn"
        onClick={(e) => props.onToggle(e)}
        title={props.archived ? 'Restore to active list' : 'Hide from active list'}
        aria-label={props.archived ? 'Restore initiative' : 'Archive initiative'}
      >
        <Show
          when={props.archived}
          fallback={
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
              <path d="M10 12h4" />
            </svg>
          }
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
        </Show>
      </button>
    </span>
  );
}
