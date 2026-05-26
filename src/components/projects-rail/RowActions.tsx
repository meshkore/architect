/**
 * RowActions — hover-overlay action buttons for a project rail row.
 *
 * The overlay sits inside `.proj-row-wrap` (sibling of `.proj-row`)
 * with `position: absolute`, so it visually floats over the row but
 * doesn't nest a clickable area inside the row's `<button>`.
 *
 * Each action stops mousedown/pointerdown so Chrome's HTML5 drag
 * system doesn't claim the click before it resolves.
 */

import { Show } from 'solid-js';
import { stopProject } from '~/components/ProjectsRailRow';

const swallowMouseDown = (e: MouseEvent): void => { e.stopPropagation(); };

export interface RowActionsProps {
  live: boolean;
  port: number;
  base: string;
  onEdit: () => void;
  onDelete: () => void;
  onAfterStop: () => void;
}

export default function RowActions(props: RowActionsProps) {
  return (
    <div class="proj-actions">
      <button
        type="button"
        class="proj-action is-edit"
        title="Rename"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={swallowMouseDown}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); props.onEdit(); }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <Show when={props.live}>
        <button
          type="button"
          class="proj-action is-stop"
          title="Stop daemon"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={swallowMouseDown}
          onClick={(e) => {
            e.stopPropagation(); e.preventDefault();
            void stopProject(props.port, props.base, props.onAfterStop);
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1.5" />
          </svg>
        </button>
      </Show>
      <button
        type="button"
        class="proj-action is-delete"
        title="Forget project (remove from rail)"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={swallowMouseDown}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); props.onDelete(); }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
        </svg>
      </button>
    </div>
  );
}
