/**
 * layoutStore — main cockpit column order, persisted to localStorage.
 *
 * The cockpit has three top-level columns inside `.three-col`:
 *
 *   nav    Modules tree
 *   ws     Workspace (Roadmap / Tasks / Context / Diagrams)
 *   chat   Chat (rail + thread)
 *
 * Each operator can reorder these by dragging a 9-dot grip on the
 * header bar. Default order is `nav → ws → chat`. The grid slots
 * themselves stay positional (`col-nav` at slot 0, `col-chat` at
 * slot 4); only the COLUMN CONTENT moves between slots.
 *
 * Ported from the pre-Solid monolith's `ColumnReorder` IIFE
 * (architect/public/index.html, deleted 2026-05-18 cd931df).
 * Operator field report 2026-06-10: "esto funcionaba antes de uno
 * de los grandes rediseños cuando pasamos de vanilla JavaScript a
 * solidJS … vuelve a activarlo."
 */

import { createMemo, createRoot, createSignal } from 'solid-js';

export type ColumnId = 'nav' | 'ws' | 'chat';
const ORDER_KEY = 'mc-panel-order-v1';   // legacy key, preserved
const WIDTHS_KEY = 'mc-panel-widths-v1'; // legacy key, preserved
const SPLITTER_LAYOUT_KEY = 'mc-layout-v1'; // Splitter writes here
const DEFAULT_ORDER: readonly ColumnId[] = ['nav', 'ws', 'chat'];

/** Width per panel, in pixels. Travels with the panel when the
 *  operator drags it to a different slot. Defaults chosen to match
 *  the long-standing column dimensions: a narrow nav, a wide chat,
 *  and a sensible value for `ws` for the rare case it lands on an
 *  edge (its primary home is the flexible `1fr` middle slot). */
type PanelWidths = Record<ColumnId, number>;
const DEFAULT_WIDTHS: PanelWidths = { nav: 220, ws: 540, chat: 420 };

function loadOrder(): ColumnId[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...DEFAULT_ORDER];
    const v = JSON.parse(raw);
    if (
      Array.isArray(v)
      && v.length === 3
      && new Set(v).size === 3
      && v.every((x) => x === 'nav' || x === 'ws' || x === 'chat')
    ) {
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
        nav: typeof v.nav === 'number' && Number.isFinite(v.nav) ? v.nav : DEFAULT_WIDTHS.nav,
        ws: typeof v.ws === 'number' && Number.isFinite(v.ws) ? v.ws : DEFAULT_WIDTHS.ws,
        chat: typeof v.chat === 'number' && Number.isFinite(v.chat) ? v.chat : DEFAULT_WIDTHS.chat,
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

/** Push the current edge panels' widths to the CSS vars AND mirror
 *  them into the Splitter's mc-layout-v1 store so the two views stay
 *  consistent (Splitter reads mc-layout-v1 on its onMount). */
function syncSlotVarsFromWidths(order: readonly ColumnId[], widths: PanelWidths): void {
  if (typeof document === 'undefined') return;
  const slot0 = order[0]!;
  const slot2 = order[2]!;
  const navPx = widths[slot0];
  const chatPx = widths[slot2];
  document.documentElement.style.setProperty('--col-nav', `${navPx}px`);
  document.documentElement.style.setProperty('--col-chat', `${chatPx}px`);
  try {
    const raw = localStorage.getItem(SPLITTER_LAYOUT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed['col-nav'] = navPx;
    parsed['col-chat'] = chatPx;
    localStorage.setItem(SPLITTER_LAYOUT_KEY, JSON.stringify(parsed));
  } catch { /* quota */ }
}

const [orderSig, setOrderSig] = createRoot(() => createSignal<readonly ColumnId[]>(loadOrder()));
const [widthsSig, setWidthsSig] = createRoot(() => createSignal<PanelWidths>(loadWidths()));

// One-shot boot sync: align the slot CSS vars with the current
// per-panel widths under the saved order. The Splitter component's
// onMount runs `applyStoredLayout` separately; this push happens
// before the first paint so the columns render at the right widths.
if (typeof document !== 'undefined') {
  syncSlotVarsFromWidths(orderSig(), widthsSig());
}

export const layoutStore = {
  /** Current column order — [slot0, slot1, slot2]. */
  order: orderSig,

  /** Per-panel widths in pixels. Travels with the panel between slots. */
  widths: widthsSig,

  /** `nav` is at the leftmost slot? Used to decide whether the
   *  Modules collapse button works (positional CSS bound to
   *  `.nav-collapsed` only covers the slot-0 case). */
  navAtLeftEdge: createRoot(() => createMemo(() => orderSig()[0] === 'nav')),

  /** `chat` is at the rightmost slot? Same reason as navAtLeftEdge. */
  chatAtRightEdge: createRoot(() => createMemo(() => orderSig()[2] === 'chat')),

  /** Move `panel` to `targetIndex` (0..2). Other panels shift to fill
   *  the gap. INSERT-AT semantics (matches the new drag-and-drop UX
   *  the operator asked for 2026-06-10) — not a simple swap. */
  moveTo(panel: ColumnId, targetIndex: number): void {
    const cur = orderSig();
    const src = cur.indexOf(panel);
    if (src < 0) return;
    const clamped = Math.max(0, Math.min(2, Math.floor(targetIndex)));
    if (clamped === src) return;
    const without = cur.filter((c) => c !== panel) as ColumnId[];
    const next = [...without.slice(0, clamped), panel, ...without.slice(clamped)] as ColumnId[];
    setOrderSig(next);
    persistOrder(next);
    syncSlotVarsFromWidths(next, widthsSig());
  },

  /** Swap two columns. Kept for callers that prefer the explicit swap
   *  semantics; INSERT-AT (`moveTo`) is the canonical operation now. */
  swap(a: ColumnId, b: ColumnId): void {
    if (a === b) return;
    const cur = orderSig();
    const i = cur.indexOf(a);
    const j = cur.indexOf(b);
    if (i < 0 || j < 0) return;
    const next = cur.slice() as ColumnId[];
    next[i] = b;
    next[j] = a;
    setOrderSig(next);
    persistOrder(next);
    syncSlotVarsFromWidths(next, widthsSig());
  },

  /** Called by the Splitter when the operator finishes dragging a
   *  `col-nav` or `col-chat` handle. Records the new width into the
   *  panel currently at that slot so the value travels with the
   *  panel the next time the order changes. */
  recordSlotWidth(slot: 'col-nav' | 'col-chat', px: number): void {
    const ord = orderSig();
    const panel = slot === 'col-nav' ? ord[0] : ord[2];
    if (!panel) return;
    const next = { ...widthsSig(), [panel]: px };
    setWidthsSig(next);
    persistWidths(next);
  },

  /** Push the per-panel widths into the slot CSS vars + Splitter's
   *  in-memory layout store. Called on swap/move so the slot widths
   *  reflect the new edge panels' saved widths. */
  syncSlotVars(): void {
    syncSlotVarsFromWidths(orderSig(), widthsSig());
  },

  /** Reset to the canonical nav→ws→chat order + default widths. */
  reset(): void {
    setOrderSig([...DEFAULT_ORDER]);
    setWidthsSig({ ...DEFAULT_WIDTHS });
    persistOrder(DEFAULT_ORDER);
    persistWidths(DEFAULT_WIDTHS);
    syncSlotVarsFromWidths(DEFAULT_ORDER, DEFAULT_WIDTHS);
  },
};
