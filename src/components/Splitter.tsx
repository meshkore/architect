/**
 * Splitter — 4 px drag handle between cockpit tracks.
 *
 * Column widths live in CSS custom properties on :root. The grids read
 * from those; drag updates the var, persisted to localStorage so widths
 * survive reloads.
 *
 * 2026-06-19 (2-col rearchitecture) — three handles:
 *   - `col-main`     → boundary between the two MAIN columns. The right
 *                      column is the fixed `--col-side` track, so drag
 *                      right SHRINKS it; sign flipped (-1).
 *   - `modules-rail` → width of the modules rail inside the roadmap
 *                      column; drag right grows it (+1).
 *   - `chat-rail`    → width of the agents rail inside the agents
 *                      column; drag right grows it (+1).
 */

import { onMount, onCleanup } from 'solid-js';
import { uiStore } from '~/state/ui';
import { layoutStore } from '~/state/layout';

const VAR: Record<string, string> = {
  'col-main': '--col-side',
  'modules-rail': '--modules-rail-w',
  'chat-rail': '--chat-rail-w',
};

const STORE_KEY = 'mc-layout-v1';

interface LayoutBounds {
  min: number;
  max: number;
  default: number;
}

const BOUNDS: Record<string, LayoutBounds> = {
  // The main boundary resizes the FIXED right column. The left column
  // is the flexible `1fr` track with no min, so it absorbs the slack;
  // the wide ceiling lets operators on big monitors give the right
  // column a lot of room without breaking the layout.
  'col-main':  { min: 320, max: 1400, default: 620 },
  // Modules rail inside the roadmap column. Min low enough that it can
  // squeeze to a thin strip (text truncates) like the agents rail.
  'modules-rail': { min: 56, max: 420, default: 220 },
  // Agents rail inside the agents column. Min 50 so it can collapse to
  // just the A001-style id chip + status dot (AgentCard drops chips +
  // body title below its compact threshold).
  'chat-rail': { min: 50, max: 320, default: 200 },
};

function loadLayout(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const k of Object.keys(BOUNDS)) {
      const v = parsed[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveLayout(layout: Record<string, number>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(layout));
  } catch {
    /* quota */
  }
}

function clamp(key: string, px: number): number {
  const b = BOUNDS[key];
  if (!b) return px;
  return Math.max(b.min, Math.min(b.max, px));
}

let initialised = false;
const layout: Record<string, number> = {};

/** Apply the layout map to the :root CSS variables. Public so app boot
 *  can call it once to hydrate from localStorage before paint. */
export function applyStoredLayout(): void {
  if (initialised) return;
  initialised = true;
  const saved = loadLayout();
  for (const key of Object.keys(BOUNDS) as Array<keyof typeof BOUNDS>) {
    layout[key] = saved[key] ?? BOUNDS[key]!.default;
  }
  for (const [k, v] of Object.entries(layout)) {
    document.documentElement.style.setProperty(VAR[k]!, `${v}px`);
  }
  // V91 — keep uiStore.chatRailWidth in sync with the splitter's
  // chat-rail slot at boot. ChatRail's `compact` derivation reads
  // from uiStore (reactive) so AgentCard can switch to the compact
  // layout once the operator drags below COMPACT_THRESHOLD_PX. Without
  // this sync the rail stayed in full layout no matter how narrow.
  if (typeof layout['chat-rail'] === 'number') {
    uiStore.setChatRailWidth(layout['chat-rail']);
  }
  if (typeof layout['modules-rail'] === 'number') {
    uiStore.setModulesRailWidth(layout['modules-rail']);
  }
}

export default function Splitter(props: { resize: 'col-main' | 'modules-rail' | 'chat-rail'; class?: string; title?: string }) {
  let host: HTMLDivElement | undefined;

  onMount(() => {
    applyStoredLayout();
    if (!host) return;
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      host!.classList.add('dragging');
      document.body.classList.add('resizing');
      const startX = e.clientX;
      const startPx = layout[props.resize] ?? BOUNDS[props.resize]!.default;
      // col-main resizes the FIXED right column: dragging right SHRINKS it.
      const sign = props.resize === 'col-main' ? -1 : 1;

      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX;
        const next = clamp(props.resize, Math.round(startPx + sign * dx));
        layout[props.resize] = next;
        document.documentElement.style.setProperty(VAR[props.resize]!, `${next}px`);
        // Mirror the rail widths into uiStore so the rails' compact
        // memos react on every move (AgentCard collapses below its
        // compact threshold; modules tree truncates).
        if (props.resize === 'chat-rail') {
          uiStore.setChatRailWidth(next);
        } else if (props.resize === 'modules-rail') {
          uiStore.setModulesRailWidth(next);
        }
      };
      const onUp = (): void => {
        host!.classList.remove('dragging');
        document.body.classList.remove('resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        saveLayout(layout);
        // Record the right-column width against the PANEL currently in
        // the fixed slot so it travels when the operator swaps columns.
        if (props.resize === 'col-main') {
          layoutStore.recordSideWidth(layout[props.resize]!);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    host.addEventListener('pointerdown', onDown);
    onCleanup(() => host?.removeEventListener('pointerdown', onDown));
  });

  return (
    <div
      ref={host}
      class={`splitter splitter-${props.resize} ${props.class ?? ''}`}
      data-resize={props.resize}
      title={props.title ?? 'Drag to resize'}
    />
  );
}
