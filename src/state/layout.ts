/**
 * layoutStore — main cockpit column order, persisted to localStorage.
 *
 * 2026-06-19 rearchitecture (3-col → 2-col). The cockpit now has TWO
 * top-level columns inside `.two-col`:
 *
 *   roadmap   Modules rail + workspace content (Roadmap / Context /
 *             Diagrams / Protocols). Modules used to be its own
 *             top-level `nav` column; it's now an inner rail of the
 *             roadmap column — exactly mirroring how the agents column
 *             carries the chat rail.
 *   agents    Agents rail + chat thread.
 *
 * Each main column is the same shape: `[secondary rail | splitter |
 * primary content]`. The two MAIN columns are reorderable by dragging
 * the 9-dot grip in each column header.
 *
 * Grid slots stay positional: slot-0 (left) is the flexible `1fr`
 * column; slot-2 (right) takes its width from `--col-side`. The single
 * `col-main` splitter resizes the right column. Only the COLUMN
 * CONTENT moves between slots — see `ColumnDragGrip.tsx`.
 */

import { createMemo, createRoot, createSignal } from 'solid-js';

export type ColumnId = 'roadmap' | 'agents';
const ORDER_KEY = 'mc-panel-order-v2';   // v2: 2-column order
const WIDTHS_KEY = 'mc-panel-widths-v2';
const SPLITTER_LAYOUT_KEY = 'mc-layout-v1'; // Splitter writes here
const DEFAULT_ORDER: readonly ColumnId[] = ['roadmap', 'agents'];

const isCol = (x: unknown): x is ColumnId => x === 'roadmap' || x === 'agents';

/** Width per panel, in pixels — applied only while the panel sits in
 *  the FIXED right slot (slot-2). Travels with the panel when the
 *  operator reorders. The left slot is always `1fr`. */
type PanelWidths = Record<ColumnId, number>;
const DEFAULT_WIDTHS: PanelWidths = { roadmap: 620, agents: 600 };

function loadOrder(): ColumnId[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...DEFAULT_ORDER];
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.length === 2 && new Set(v).size === 2 && v.every(isCol)) {
      return v as ColumnId[];
    }
  } catch {
    // ignore — fall through to default
  }
  return [...DEFAULT_ORDER];
}

function persistOrder(order: readonly ColumnId[]): void {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* quota */ }
}

function loadWidths(): PanelWidths {
  try {
    const raw = localStorage.getItem(WIDTHS_KEY);
    if (!raw) return { ...DEFAULT_WIDTHS };
    const v = JSON.parse(raw);
    if (v && typeof v === 'object') {
      return {
        roadmap: typeof v.roadmap === 'number' && Number.isFinite(v.roadmap) ? v.roadmap : DEFAULT_WIDTHS.roadmap,
        agents: typeof v.agents === 'number' && Number.isFinite(v.agents) ? v.agents : DEFAULT_WIDTHS.agents,
      };
    }
  } catch {
    // ignore — fall through to default
  }
  return { ...DEFAULT_WIDTHS };
}

function persistWidths(w: PanelWidths): void {
  try { localStorage.setItem(WIDTHS_KEY, JSON.stringify(w)); } catch { /* quota */ }
}

/** Push the fixed (right) panel's width to `--col-side` AND mirror it
 *  into the Splitter's mc-layout-v1 store so the two views stay
 *  consistent (Splitter reads mc-layout-v1 on its onMount). */
function syncSlotVarsFromWidths(order: readonly ColumnId[], widths: PanelWidths): void {
  if (typeof document === 'undefined') return;
  const rightPanel = order[1]!;
  const sidePx = widths[rightPanel];
  document.documentElement.style.setProperty('--col-side', `${sidePx}px`);
  try {
    const raw = localStorage.getItem(SPLITTER_LAYOUT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed['col-main'] = sidePx;
    localStorage.setItem(SPLITTER_LAYOUT_KEY, JSON.stringify(parsed));
  } catch { /* quota */ }
}

const [orderSig, setOrderSig] = createRoot(() => createSignal<readonly ColumnId[]>(loadOrder()));
const [widthsSig, setWidthsSig] = createRoot(() => createSignal<PanelWidths>(loadWidths()));

// One-shot boot sync: align the `--col-side` var with the current
// fixed-panel width under the saved order, before the first paint.
if (typeof document !== 'undefined') {
  syncSlotVarsFromWidths(orderSig(), widthsSig());
}

export const layoutStore = {
  /** Current column order — [leftSlot, rightSlot]. */
  order: orderSig,

  /** Per-panel widths in pixels (only applied in the fixed right slot). */
  widths: widthsSig,

  /** Which column sits in the flexible left slot. */
  leftPanel: createRoot(() => createMemo(() => orderSig()[0]!)),

  /** Which column sits in the fixed right slot. */
  rightPanel: createRoot(() => createMemo(() => orderSig()[1]!)),

  /** Move `panel` to `targetIndex` (0..1). The other panel fills the
   *  gap. With two columns this is a swap, expressed as insert-at so it
   *  shares the ColumnDragGrip drop math. */
  moveTo(panel: ColumnId, targetIndex: number): void {
    const cur = orderSig();
    const src = cur.indexOf(panel);
    if (src < 0) return;
    const clamped = Math.max(0, Math.min(1, Math.floor(targetIndex)));
    if (clamped === src) return;
    const without = cur.filter((c) => c !== panel) as ColumnId[];
    const next = [...without.slice(0, clamped), panel, ...without.slice(clamped)] as ColumnId[];
    setOrderSig(next);
    persistOrder(next);
    syncSlotVarsFromWidths(next, widthsSig());
  },

  /** Swap the two columns. */
  swap(): void {
    const next = [...orderSig()].reverse() as ColumnId[];
    setOrderSig(next);
    persistOrder(next);
    syncSlotVarsFromWidths(next, widthsSig());
  },

  /** Called by the Splitter when the operator finishes dragging the
   *  `col-main` handle. Records the new width against the PANEL
   *  currently in the fixed right slot so the value travels with it
   *  when the order changes. */
  recordSideWidth(px: number): void {
    const panel = orderSig()[1];
    if (!panel) return;
    const next = { ...widthsSig(), [panel]: px };
    setWidthsSig(next);
    persistWidths(next);
  },

  /** Push the per-panel widths into `--col-side` + Splitter store. */
  syncSlotVars(): void {
    syncSlotVarsFromWidths(orderSig(), widthsSig());
  },

  /** Reset to the canonical roadmap→agents order + default widths. */
  reset(): void {
    setOrderSig([...DEFAULT_ORDER]);
    setWidthsSig({ ...DEFAULT_WIDTHS });
    persistOrder(DEFAULT_ORDER);
    persistWidths(DEFAULT_WIDTHS);
    syncSlotVarsFromWidths(DEFAULT_ORDER, DEFAULT_WIDTHS);
  },
};
