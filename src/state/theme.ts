/**
 * themeStore — current theme preset + size preset + per-variable
 * overrides (theme vars AND font-size vars).
 *
 * Pushes the merged maps onto `document.documentElement.style` on every
 * mutation. Every CSS rule using `var(--theme-…)` or `var(--fs-…)`
 * reacts. Persisted to localStorage under `mc-theme-v1` so the choice
 * survives reload. Boot path applies synchronously at module init so
 * the cockpit never flashes the wrong colours / sizes.
 *
 * Initiative `cockpit-themes`; expanded 2026-06-10 to cover sizes +
 * a bigger override surface (text/surface tokens in addition to
 * the chat-user override).
 */

import { createRoot, createSignal } from 'solid-js';
import {
  THEMES,
  SIZE_PRESETS,
  type ThemeId,
  type SizeId,
} from '~/lib/theme-presets';

const STORE_KEY = 'mc-theme-v1';
const DEFAULT_THEME_ID: ThemeId = 'emerald';
const DEFAULT_SIZE_ID: SizeId = 'default';

interface PersistedTheme {
  themeId: ThemeId;
  sizeId: SizeId;
  overrides: Record<string, string>;
}

function loadFromStorage(): PersistedTheme {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { themeId: DEFAULT_THEME_ID, sizeId: DEFAULT_SIZE_ID, overrides: {} };
    const parsed = JSON.parse(raw) as {
      themeId?: string;
      sizeId?: string;
      overrides?: unknown;
    };
    return {
      themeId: isThemeId(parsed.themeId) ? parsed.themeId : DEFAULT_THEME_ID,
      sizeId: isSizeId(parsed.sizeId) ? parsed.sizeId : DEFAULT_SIZE_ID,
      overrides:
        parsed.overrides && typeof parsed.overrides === 'object'
          ? sanitiseOverrides(parsed.overrides as Record<string, unknown>)
          : {},
    };
  } catch {
    return { themeId: DEFAULT_THEME_ID, sizeId: DEFAULT_SIZE_ID, overrides: {} };
  }
}

function isThemeId(s: unknown): s is ThemeId {
  return s === 'emerald' || s === 'indigo' || s === 'amber' || s === 'slate';
}

function isSizeId(s: unknown): s is SizeId {
  return s === 'compact' || s === 'default' || s === 'large';
}

function sanitiseOverrides(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (
      typeof k === 'string'
      && (k.startsWith('--theme-') || k.startsWith('--fs-'))
      && typeof v === 'string'
    ) {
      out[k] = v;
    }
  }
  return out;
}

function persist(state: PersistedTheme): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

function applyAll(
  themeId: ThemeId,
  sizeId: SizeId,
  overrides: Record<string, string>,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const theme = THEMES[themeId];
  for (const [k, v] of Object.entries(theme)) {
    root.setProperty(k, overrides[k] ?? v);
  }
  const sizes = SIZE_PRESETS[sizeId];
  for (const [k, v] of Object.entries(sizes)) {
    root.setProperty(k, overrides[k] ?? v);
  }
}

const initial = loadFromStorage();
const [themeIdSig, setThemeIdSig] = createRoot(() =>
  createSignal<ThemeId>(initial.themeId),
);
const [sizeIdSig, setSizeIdSig] = createRoot(() =>
  createSignal<SizeId>(initial.sizeId),
);
const [overridesSig, setOverridesSig] = createRoot(() =>
  createSignal<Record<string, string>>(initial.overrides),
);

// Synchronous boot apply — runs at module init so the cockpit
// renders with the saved theme + size on first paint, no flash.
applyAll(themeIdSig(), sizeIdSig(), overridesSig());

function snapshot(): PersistedTheme {
  return {
    themeId: themeIdSig(),
    sizeId: sizeIdSig(),
    overrides: overridesSig(),
  };
}

export const themeStore = {
  themeId: themeIdSig,
  sizeId: sizeIdSig,
  overrides: overridesSig,

  /** Switch theme preset. Overrides survive (operator's custom picks
   *  outlive preset swaps). Call `resetOverrides()` to clear. */
  setThemeId(id: ThemeId): void {
    setThemeIdSig(id);
    applyAll(id, sizeIdSig(), overridesSig());
    persist(snapshot());
  },

  /** Switch size preset. Operator can still pin individual `--fs-*`
   *  overrides; preserved across switches. */
  setSizeId(id: SizeId): void {
    setSizeIdSig(id);
    applyAll(themeIdSig(), id, overridesSig());
    persist(snapshot());
  },

  /** Set a single override (theme var or font-size var) or clear with null. */
  setOverride(varName: string, value: string | null): void {
    const next = { ...overridesSig() };
    if (value === null) delete next[varName];
    else next[varName] = value;
    setOverridesSig(next);
    applyAll(themeIdSig(), sizeIdSig(), next);
    persist({ themeId: themeIdSig(), sizeId: sizeIdSig(), overrides: next });
  },

  /** Drop every override; the presets' pure values take over. */
  resetOverrides(): void {
    setOverridesSig({});
    applyAll(themeIdSig(), sizeIdSig(), {});
    persist({ themeId: themeIdSig(), sizeId: sizeIdSig(), overrides: {} });
  },

  /** Full reset — back to Emerald / Default. */
  resetAll(): void {
    setThemeIdSig(DEFAULT_THEME_ID);
    setSizeIdSig(DEFAULT_SIZE_ID);
    setOverridesSig({});
    applyAll(DEFAULT_THEME_ID, DEFAULT_SIZE_ID, {});
    persist({
      themeId: DEFAULT_THEME_ID,
      sizeId: DEFAULT_SIZE_ID,
      overrides: {},
    });
  },
};
