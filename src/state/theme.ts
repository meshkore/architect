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
  type ChatPaletteId,
} from '~/lib/theme-presets';

const STORE_KEY = 'mc-theme-v1';
const DEFAULT_THEME_ID: ThemeId = 'emerald';
const DEFAULT_SIZE_ID: SizeId = 'default';
const DEFAULT_CHAT_PALETTE: ChatPaletteId = 'colorful';

interface PersistedTheme {
  themeId: ThemeId;
  sizeId: SizeId;
  chatPalette: ChatPaletteId;
  overrides: Record<string, string>;
}

function loadFromStorage(): PersistedTheme {
  const fallback: PersistedTheme = {
    themeId: DEFAULT_THEME_ID,
    sizeId: DEFAULT_SIZE_ID,
    chatPalette: DEFAULT_CHAT_PALETTE,
    overrides: {},
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      themeId?: string;
      sizeId?: string;
      chatPalette?: string;
      overrides?: unknown;
    };
    return {
      themeId: isThemeId(parsed.themeId) ? parsed.themeId : DEFAULT_THEME_ID,
      sizeId: isSizeId(parsed.sizeId) ? parsed.sizeId : DEFAULT_SIZE_ID,
      chatPalette: isChatPalette(parsed.chatPalette) ? parsed.chatPalette : DEFAULT_CHAT_PALETTE,
      overrides:
        parsed.overrides && typeof parsed.overrides === 'object'
          ? sanitiseOverrides(parsed.overrides as Record<string, unknown>)
          : {},
    };
  } catch {
    return fallback;
  }
}

function isThemeId(s: unknown): s is ThemeId {
  return s === 'emerald' || s === 'indigo' || s === 'amber' || s === 'slate';
}

function isSizeId(s: unknown): s is SizeId {
  return s === 'compact' || s === 'default' || s === 'large';
}

function isChatPalette(s: unknown): s is ChatPaletteId {
  return s === 'colorful' || s === 'mono';
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
  chatPalette: ChatPaletteId,
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
  document.documentElement.dataset.chatPalette = chatPalette;
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
const [chatPaletteSig, setChatPaletteSig] = createRoot(() =>
  createSignal<ChatPaletteId>(initial.chatPalette),
);

// Synchronous boot apply — runs at module init so the cockpit
// renders with the saved theme + size on first paint, no flash.
applyAll(themeIdSig(), sizeIdSig(), chatPaletteSig(), overridesSig());

function snapshot(): PersistedTheme {
  return {
    themeId: themeIdSig(),
    sizeId: sizeIdSig(),
    chatPalette: chatPaletteSig(),
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
    applyAll(id, sizeIdSig(), chatPaletteSig(), overridesSig());
    persist(snapshot());
  },

  /** Switch size preset. Operator can still pin individual `--fs-*`
   *  overrides; preserved across switches. */
  setSizeId(id: SizeId): void {
    setSizeIdSig(id);
    applyAll(themeIdSig(), id, chatPaletteSig(), overridesSig());
    persist(snapshot());
  },

  /** Set a single override (theme var or font-size var) or clear with null. */
  setOverride(varName: string, value: string | null): void {
    const next = { ...overridesSig() };
    if (value === null) delete next[varName];
    else next[varName] = value;
    setOverridesSig(next);
    applyAll(themeIdSig(), sizeIdSig(), chatPaletteSig(), next);
    persist({ themeId: themeIdSig(), sizeId: sizeIdSig(), chatPalette: chatPaletteSig(), overrides: next });
  },

  /** 2026-06-12 — Chat output palette flag. `colorful` (default)
   *  enables the JetBrains-Darcula per-token colours in inline code;
   *  `mono` blanks them for a Claude-Code-style near-white grayscale.
   *  Sits on top of the theme — the theme colours still drive
   *  buttons, status pills, byline, links, etc. */
  chatPalette: chatPaletteSig,
  setChatPalette(id: ChatPaletteId): void {
    setChatPaletteSig(id);
    applyAll(themeIdSig(), sizeIdSig(), id, overridesSig());
    persist(snapshot());
  },

  /** Drop every override; the presets' pure values take over. */
  resetOverrides(): void {
    setOverridesSig({});
    applyAll(themeIdSig(), sizeIdSig(), chatPaletteSig(), {});
    persist({ themeId: themeIdSig(), sizeId: sizeIdSig(), chatPalette: chatPaletteSig(), overrides: {} });
  },

  /** Full reset — back to Emerald / Default / Colorful. */
  resetAll(): void {
    setThemeIdSig(DEFAULT_THEME_ID);
    setSizeIdSig(DEFAULT_SIZE_ID);
    setChatPaletteSig(DEFAULT_CHAT_PALETTE);
    setOverridesSig({});
    applyAll(DEFAULT_THEME_ID, DEFAULT_SIZE_ID, DEFAULT_CHAT_PALETTE, {});
    persist({
      themeId: DEFAULT_THEME_ID,
      sizeId: DEFAULT_SIZE_ID,
      chatPalette: DEFAULT_CHAT_PALETTE,
      overrides: {},
    });
  },
};
