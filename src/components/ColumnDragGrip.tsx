/**
 * ColumnDragGrip — 9-dot drag handle in each cockpit column's header.
 *
 * Behaviour (matches the pre-Solid monolith's ColumnReorder system):
 *
 * - Pointer-down on the grip starts a drag.
 * - The source column gets `.col-dragging` (dim).
 * - While the pointer is over another column, that column gets
 *   `.col-drop-target` (emerald glow).
 * - Pointer-up over a different column → swap positions via
 *   `layoutStore.swap()`. Pointer-up over the same column or
 *   nowhere → cancel.
 * - `body.col-reordering` switches the cursor to grabbing globally
 *   so the operator's mouse never reverts to a text-caret mid-drag.
 *
 * The grip lives INSIDE the column header so it moves with the
 * column when reordered. Each `.col` element MUST carry a
 * `data-panel-id="nav" | "ws" | "chat"` attribute so the drag
 * handler can identify the target via `elementFromPoint`.
 */

import { layoutStore, type ColumnId } from '~/state/layout';

const LABEL: Record<ColumnId, string> = {
  nav: 'Modules',
  ws: 'Workspace',
  chat: 'Chat',
};

function panelUnderPointer(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;
  return el.closest('[data-panel-id]') as HTMLElement | null;
}

function startDrag(panelId: ColumnId, ev: PointerEvent): void {
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();

  const root = document.body;
  root.classList.add('col-reordering');
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-panel-id]'));
  const src = panels.find((p) => p.dataset.panelId === panelId);
  src?.classList.add('col-dragging');

  const clearTargets = (): void => {
    panels.forEach((p) => p.classList.remove('col-drop-target'));
  };

  const onMove = (e: PointerEvent): void => {
    const tgt = panelUnderPointer(e.clientX, e.clientY);
    panels.forEach((p) =>
      p.classList.toggle(
        'col-drop-target',
        p === tgt && p.dataset.panelId !== panelId,
      ),
    );
  };

  const onUp = (e: PointerEvent): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    root.classList.remove('col-reordering');
    src?.classList.remove('col-dragging');
    const tgt = panelUnderPointer(e.clientX, e.clientY);
    clearTargets();
    if (tgt && tgt.dataset.panelId && tgt.dataset.panelId !== panelId) {
      layoutStore.swap(panelId, tgt.dataset.panelId as ColumnId);
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

export default function ColumnDragGrip(props: { panelId: ColumnId }) {
  return (
    <button
      type="button"
      class="col-drag-grip"
      title={`Drag to move the ${LABEL[props.panelId]} column`}
      aria-label={`Reorder ${LABEL[props.panelId]} column`}
      onPointerDown={(e) => startDrag(props.panelId, e)}
    >
      <svg
        viewBox="0 0 16 16"
        width="11"
        height="11"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx="5" cy="3" r="1.3" />
        <circle cx="11" cy="3" r="1.3" />
        <circle cx="5" cy="8" r="1.3" />
        <circle cx="11" cy="8" r="1.3" />
        <circle cx="5" cy="13" r="1.3" />
        <circle cx="11" cy="13" r="1.3" />
      </svg>
    </button>
  );
}
