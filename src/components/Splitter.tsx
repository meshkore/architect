/**
 * Splitter — 4 px drag handle between V80 .three-col tracks.
 *
 * V80 stores the column widths in CSS custom properties on :root
 * (`--col-nav`, `--col-chat`, `--chat-rail-w`). The three-col grid
 * template reads from those. We replicate the same scheme — drag
 * updates the var, persisted to localStorage so widths survive
 * reloads.
 *
 * Sign convention (V80):
 *   - `col-nav`  → drag right grows the leftmost column.
 *   - `col-chat` → drag right SHRINKS the chat (it lives on the
 *                  right edge); sign flipped.
 *   - `chat-rail`→ drag right grows the rail; sign +1.
 */

import { onMount, onCleanup } from 'solid-js';
import { uiStore } from '~/state/ui';
import { layoutStore } from '~/state/layout';

const VAR: Record<string, string> = {
  'col-nav': '--col-nav',
  'col-chat': '--col-chat',
  'chat-rail': '--chat-rail-w',
};

const STORE_KEY = 'mc-layout-v1';

interface LayoutBounds {
  min: number;
  max: number;
  default: number;
}

const BOUNDS: Record<string, LayoutBounds> = {
  'col-nav':   { min: 160, max: 360, default: 220 },
  // V86z — col-chat max raised 700 → 960 so the operator can expand
  // the chat panel further and shrink the central roadmap column by
  // the same amount (roadmap is the flex middle, has no explicit min).
  // V107.39 — raised again 960 → 1400 (+45%). Operator field report
  // 2026-06-08: hit the 960 ceiling and couldn't shrink the roadmap
  // any further to give the chat more room. The roadmap is the `1fr`
  // middle column with no min, so it shrinks gracefully as col-chat
  // grows; the new ceiling lets operators on wider monitors reclaim
  // a lot more chat real estate without breaking the layout
  // (collapses to 36 px chat icon are handled by .chat-collapsed
  // independently of this max).
  'col-chat':  { min: 280, max: 1400, default: 420 },
  // V86z — agents-rail min lowered 70 → 50 so the column can collapse
  // to just the A001-style id chip + status dot (~44 px chip + 6 px
  // padding). AgentCard already drops chips + body title below 130 px
  // (V86o compact mode), so the layout stays sane all the way down.
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
}

export default function Splitter(props: { resize: 'col-nav' | 'col-chat' | 'chat-rail'; class?: string; title?: string }) {
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
      // col-chat lives on the right edge: dragging right SHRINKS it.
      const sign = props.resize === 'col-chat' ? -1 : 1;

      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX;
        const next = clamp(props.resize, Math.round(startPx + sign * dx));
        layout[props.resize] = next;
        document.documentElement.style.setProperty(VAR[props.resize]!, `${next}px`);
        // V91 — Mirror the rail width into uiStore so ChatRail's
        // compact memo (which reads uiStore.chatRailWidth) reacts on
        // every move. Otherwise the column visually shrinks via CSS
        // but AgentCard never collapses to its compact body.
        if (props.resize === 'chat-rail') {
          uiStore.setChatRailWidth(next);
        }
      };
      const onUp = (): void => {
        host!.classList.remove('dragging');
        document.body.classList.remove('resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        saveLayout(layout);
        // 2026-06-10 — record the new width against the PANEL that
        // currently occupies the edge slot, not the slot itself. So
        // when the operator drags Modules to the right and drops it
        // on the chat slot, Modules keeps its narrow width instead
        // of being inflated to the chat-slot's stored value. The
        // store separately syncs `--col-nav` / `--col-chat` on swap.
        if (props.resize === 'col-nav' || props.resize === 'col-chat') {
          layoutStore.recordSlotWidth(props.resize, layout[props.resize]!);
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
