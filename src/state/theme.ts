/**
 * themeStore — current theme preset + per-variable overrides.
 *
 * Pushes the merged map onto `document.documentElement.style` whenever
 * the selection changes; every CSS rule using `var(--theme-…)` reacts.
 * Persists to localStorage under `mc-theme-v1`. Boot path:
 *
 *   1. Module init loads from localStorage (or default emerald).
 *   2. `applyTheme()` runs once synchronously — before the first
 *      paint — so the cockpit never flashes the wrong colours.
 *
 * Initiative `cockpit-themes`, task THM-03.
 */

import { createRoot, createSignal } from 'solid-js';
import { THEMES, type ThemeId } from '~/lib/theme-presets';

const STORE_KEY = 'mc-theme-v1';
const DEFAULT_ID: ThemeId = 'emerald';

interface PersistedTheme {
  themeId: ThemeId;
  overrides: Record<string, string>;
}

function loadFromStorage(): PersistedTheme {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { themeId: DEFAULT_ID, overrides: {} };
    const parsed = JSON.parse(raw) as { themeId?: string; overrides?: unknown };
    const id = isThemeId(parsed.themeId) ? parsed.themeId : DEFAULT_ID;
    const overrides =
      parsed.overrides && typeof parsed.overrides === 'object'
        ? sanitiseOverrides(parsed.overrides as Record<string, unknown>)
        : {};
    return { themeId: id, overrides };
  } catch {
    return { themeId: DEFAULT_ID, overrides: {} };
  }
}

function isThemeId(s: unknown): s is ThemeId {
  return s === 'emerald' || s === 'indigo' || s === 'amber' || s === 'slate';
}

function sanitiseOverrides(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k === 'string' && k.startsWith('--theme-') && typeof v === 'string') {
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

function applyTheme(themeId: ThemeId, overrides: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  const preset = THEMES[themeId];
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(preset)) {
    root.setProperty(k, overrides[k] ?? v);
  }
}

const initial = loadFromStorage();
const [themeIdSig, setThemeIdSig] = createRoot(() =>
  createSignal<ThemeId>(initial.themeId),
);
const [overridesSig, setOverridesSig] = createRoot(() =>
  createSignal<Record<string, string>>(initial.overrides),
);

// Synchronous boot apply — runs at module init so the cockpit
// renders with the correct theme on first paint, no flash.
applyTheme(themeIdSig(), overridesSig());

export const themeStore = {
  /** Current preset id. */
  themeId: themeIdSig,

  /** Sparse map of per-variable overrides (var → value). */
  overrides: overridesSig,

  /** Switch preset. Overrides are PRESERVED on switch — the operator's
   *  custom user-bubble colour outlives a preset change. To clear them,
   *  call `resetOverrides()` first. */
  setThemeId(id: ThemeId): void {
    setThemeIdSig(id);
    applyTheme(id, overridesSig());
    persist({ themeId: id, overrides: overridesSig() });
  },

  /** Set a per-variable override, or pass `null` to clear it. */
  setOverride(varName: string, value: string | null): void {
    const next = { ...overridesSig() };
    if (value === null) {
      delete next[varName];
    } else {
      next[varName] = value;
    }
    setOverridesSig(next);
    applyTheme(themeIdSig(), next);
    persist({ themeId: themeIdSig(), overrides: next });
  },

  /** Drop every override; the preset's pure values take over. */
  resetOverrides(): void {
    setOverridesSig({});
    applyTheme(themeIdSig(), {});
    persist({ themeId: themeIdSig(), overrides: {} });
  },
};
