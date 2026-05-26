/**
 * RowActions — hover-overlay action buttons for a project rail row.
 *
 * Sits inside `.proj-row-wrap` as a sibling of `.proj-row`, floating
 * over the row via `position: absolute`. The wrap's onClick uses
 * `event.target.closest('.proj-actions')` to ignore clicks on these
 * buttons, so they fire normally without any stopPropagation gymnastics.
 */

import { Show } from 'solid-js';
import { stopProject } from '~/components/ProjectsRailRow';

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
        onClick={props.onEdit}
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
          title="Shutdown daemon (terminates the local process and any agents it spawned)"
          onClick={() => void stopProject(props.port, props.base, props.onAfterStop)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1.5" />
          </svg>
        </button>
      </Show>
      <button
        type="button"
        class="proj-action is-delete"
        title="Forget project (remove from rail, keeps daemon alive)"
        onClick={props.onDelete}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
        </svg>
      </button>
    </div>
  );
}
