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
const ORDER_KEY = 'mc-panel-order-v1';  // intentionally matches the legacy key
                                        // so operators who used the vanilla
                                        // build don't lose their preference.
const DEFAULT_ORDER: readonly ColumnId[] = ['nav', 'ws', 'chat'];

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

const [orderSig, setOrderSig] = createRoot(() => createSignal<readonly ColumnId[]>(loadOrder()));

export const layoutStore = {
  /** Current column order — [slot0, slot1, slot2]. */
  order: orderSig,

  /** `nav` is at the leftmost slot? Used to decide whether the
   *  Modules collapse button works (positional CSS bound to
   *  `.nav-collapsed` only covers the slot-0 case). */
  navAtLeftEdge: createRoot(() => createMemo(() => orderSig()[0] === 'nav')),

  /** `chat` is at the rightmost slot? Same reason as navAtLeftEdge. */
  chatAtRightEdge: createRoot(() => createMemo(() => orderSig()[2] === 'chat')),

  /** Swap two columns. No-op if either id is missing or equal. */
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
  },

  /** Reset to the canonical nav→ws→chat order. */
  reset(): void {
    setOrderSig([...DEFAULT_ORDER]);
    persistOrder(DEFAULT_ORDER);
  },
};
