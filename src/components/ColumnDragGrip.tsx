/**
 * ColumnDragGrip — 9-dot drag handle in each cockpit column's header.
 *
 * Behaviour (2026-06-10 operator rewrite — replaces the legacy
 * "swap two columns on click" with a continuous drag + INSERT-AT
 * drop):
 *
 *   1. Pointer-down on the grip starts a drag.
 *   2. The source column dims (`.col-dragging` → opacity .35).
 *   3. A floating ghost — a small chip showing the column's label —
 *      follows the cursor. Visually anchors the gesture.
 *   4. As the cursor moves, we compute the INSERTION INDEX:
 *        - If the cursor is to the left of a column's centerline,
 *          the source will land BEFORE that column.
 *        - If it's to the right of the rightmost column's center,
 *          the source lands at the end.
 *      A green vertical drop-indicator line is drawn at the
 *      insertion gap (between two columns, or before the first /
 *      after the last) so the operator sees where the panel will go.
 *   5. Pointer-up applies `layoutStore.moveTo(panel, insertionIndex)`.
 *      Pointer-cancel or release outside any column rolls everything
 *      back without changing the order.
 *
 * Operator quote (the new requirement that triggered the rewrite):
 *
 *   "Es un tipo de drag and drop que lo coges y ves directamente
 *    mover el objeto con todo su contenido y al mismo tamaño y
 *    dejar libre el espacio a medida que me acerco a la derecha
 *    de la columna que tengo en ese momento a la derecha."
 *
 * Each `.col` element MUST carry a `data-panel-id` attribute so the
 * insertion math can identify columns; the layout grid keeps the
 * splitters positional, the column CONTENT is what moves.
 */

import { layoutStore, type ColumnId } from '~/state/layout';

const LABEL: Record<ColumnId, string> = {
  roadmap: 'Roadmap',
  agents: 'Agents',
};

interface ColumnRect {
  id: ColumnId;
  el: HTMLElement;
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: number;
}

function collectColumns(): ColumnRect[] {
  const out: ColumnRect[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-panel-id]'))) {
    const id = el.dataset.panelId as ColumnId | undefined;
    if (id !== 'roadmap' && id !== 'agents') continue;
    const r = el.getBoundingClientRect();
    out.push({
      id,
      el,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      center: r.left + r.width / 2,
    });
  }
  // Sort by visual order (left-to-right).
  out.sort((a, b) => a.left - b.left);
  return out;
}

/** Compute the insertion index given the cursor X. Returns 0..2.
 *  An index of 0 means "insert at the leftmost slot", 1 means
 *  "between current slot 0 and slot 1", etc. The dragged panel's
 *  current position is excluded from the calculation so dropping on
 *  the same column doesn't trigger a change. */
function insertionIndexFor(x: number, cols: ColumnRect[], draggingId: ColumnId): number {
  const others = cols.filter((c) => c.id !== draggingId);
  // If cursor is left of the first non-dragging column's center →
  // insert at index 0.
  if (others.length > 0 && x < others[0]!.center) return 0;
  // If cursor is right of the last non-dragging column's center →
  // insert at the end.
  if (others.length > 0 && x >= others[others.length - 1]!.center) return others.length;
  // Otherwise find the first column whose center is past the cursor
  // and insert before it.
  for (let i = 0; i < others.length; i++) {
    if (x < others[i]!.center) return i;
  }
  return others.length;
}

function buildGhost(label: string): HTMLDivElement {
  const ghost = document.createElement('div');
  ghost.className = 'col-drag-ghost';
  ghost.textContent = label;
  // Position is set by the pointer-move handler.
  ghost.style.left = '0px';
  ghost.style.top = '0px';
  return ghost;
}

function buildDropIndicator(): HTMLDivElement {
  const ind = document.createElement('div');
  ind.className = 'col-drop-indicator';
  return ind;
}

/** Place the drop indicator at the gap between columns (or before the
 *  first / after the last). `insertIdx` is in the non-dragging column
 *  list returned by `collectColumns().filter(c => c.id !== dragId)`. */
function positionDropIndicator(
  ind: HTMLDivElement,
  insertIdx: number,
  cols: ColumnRect[],
  draggingId: ColumnId,
): void {
  const others = cols.filter((c) => c.id !== draggingId);
  if (others.length === 0) {
    ind.style.display = 'none';
    return;
  }
  let xPx: number;
  if (insertIdx <= 0) {
    xPx = others[0]!.left - 4;
  } else if (insertIdx >= others.length) {
    xPx = others[others.length - 1]!.right + 4;
  } else {
    const prev = others[insertIdx - 1]!;
    const next = others[insertIdx]!;
    xPx = (prev.right + next.left) / 2;
  }
  const top = Math.min(...others.map((c) => c.top));
  const bottom = Math.max(...others.map((c) => c.bottom));
  ind.style.display = 'block';
  ind.style.left = `${xPx - 2}px`;
  ind.style.top = `${top}px`;
  ind.style.height = `${bottom - top}px`;
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

  // Floating ghost — small chip that tracks the cursor.
  const ghost = buildGhost(LABEL[panelId]);
  document.body.appendChild(ghost);

  // Drop indicator — vertical green line at the insertion gap.
  const indicator = buildDropIndicator();
  document.body.appendChild(indicator);

  let lastIndex = -1;

  const placeGhost = (x: number, y: number): void => {
    // Keep the ghost slightly offset from the cursor so it doesn't
    // interfere with elementFromPoint lookups (none here, but it's
    // also more legible).
    ghost.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  };

  const onMove = (e: PointerEvent): void => {
    placeGhost(e.clientX, e.clientY);
    const cols = collectColumns();
    const idx = insertionIndexFor(e.clientX, cols, panelId);
    if (idx !== lastIndex) {
      positionDropIndicator(indicator, idx, cols, panelId);
      lastIndex = idx;
    }
  };

  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    root.classList.remove('col-reordering');
    src?.classList.remove('col-dragging');
    ghost.remove();
    indicator.remove();
  };

  const onUp = (e: PointerEvent): void => {
    const cols = collectColumns();
    const idx = insertionIndexFor(e.clientX, cols, panelId);
    cleanup();
    if (idx >= 0) {
      layoutStore.moveTo(panelId, idx);
    }
  };

  const onCancel = (): void => { cleanup(); };

  placeGhost(ev.clientX, ev.clientY);
  // Compute initial indicator position.
  {
    const cols = collectColumns();
    const idx = insertionIndexFor(ev.clientX, cols, panelId);
    positionDropIndicator(indicator, idx, cols, panelId);
    lastIndex = idx;
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
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
