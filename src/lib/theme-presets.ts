/**
 * theme-presets.ts — cockpit theme + size presets.
 *
 * Themes  → palette of colour CSS variables. Operator picks one of
 *           four; can override individual variables on top.
 * Sizes   → font-size scale. Three presets (compact / default / large)
 *           drive the `--fs-*` token set used across the cockpit chrome
 *           (titles, buttons, body, meta, chat).
 *
 * Each preset is a complete `{cssVar → value}` record covering its
 * group's schema declared in `cockpit.css :root`. Adding a new preset
 * is one entry in the relevant map + one entry in the matching options
 * list — no further code changes needed.
 *
 * Initiative `cockpit-themes`, expanded 2026-06-10 to cover text,
 * surface, and font-size tokens.
 */

export type ThemeId = 'emerald' | 'indigo' | 'amber' | 'slate';
export type SizeId = 'compact' | 'default' | 'large';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  /** Three swatches shown in the picker (accent, secondary, tertiary). */
  swatches: readonly [string, string, string];
}

export interface SizeMeta {
  id: SizeId;
  label: string;
  hint: string;
}

export const THEME_OPTIONS: readonly ThemeMeta[] = [
  { id: 'emerald', label: 'Emerald', swatches: ['#10b981', '#0ea5e9', '#a78bfa'] },
  { id: 'indigo',  label: 'Indigo',  swatches: ['#6366f1', '#22d3ee', '#fb7185'] },
  { id: 'amber',   label: 'Amber',   swatches: ['#f59e0b', '#ef4444', '#fde047'] },
  { id: 'slate',   label: 'Mono',    swatches: ['#94a3b8', '#7dd3fc', '#a3a3a3'] },
];

export const SIZE_OPTIONS: readonly SizeMeta[] = [
  { id: 'compact', label: 'Compact', hint: 'Dense — more content per screen' },
  { id: 'default', label: 'Default', hint: 'Original cockpit spacing' },
  { id: 'large',   label: 'Large',   hint: 'Bigger text + buttons' },
];

/** Full theme schema. Every preset MUST cover every key. */
export const THEME_VAR_NAMES = [
  '--theme-accent',
  '--theme-accent-bright',
  '--theme-accent-glow',
  '--theme-accent-soft-bg',
  '--theme-accent-soft-border',
  '--theme-status-active',
  '--theme-status-active-ring',
  '--theme-status-active-glow',
  '--theme-status-running',
  '--theme-status-running-ring',
  '--theme-status-running-glow',
  '--theme-status-next',
  '--theme-status-next-ring',
  '--theme-status-next-glow',
  '--theme-status-done',
  '--theme-status-done-ring',
  '--theme-status-done-glow',
  '--theme-byline-agent',
  '--theme-byline-user',
  '--theme-surface-tint',
  '--theme-text-primary',
  '--theme-text-secondary',
  '--theme-text-dim',
  '--theme-text-quiet',
] as const;

export type ThemeVar = (typeof THEME_VAR_NAMES)[number];

export const THEMES: Record<ThemeId, Record<ThemeVar, string>> = {
  emerald: {
    '--theme-accent': '#10b981',
    '--theme-accent-bright': '#34d399',
    '--theme-accent-glow': 'rgba(52, 211, 153, 0.45)',
    '--theme-accent-soft-bg': 'rgba(52, 211, 153, 0.06)',
    '--theme-accent-soft-border': 'rgba(52, 211, 153, 0.30)',
    '--theme-status-active': '#0ea5e9',
    '--theme-status-active-ring': '#bae6fd',
    '--theme-status-active-glow': 'rgba(14, 165, 233, 0.5)',
    '--theme-status-running': '#ec4899',
    '--theme-status-running-ring': '#fbcfe8',
    '--theme-status-running-glow': 'rgba(236, 72, 153, 0.6)',
    '--theme-status-next': '#f59e0b',
    '--theme-status-next-ring': '#fde68a',
    '--theme-status-next-glow': 'rgba(245, 158, 11, 0.45)',
    '--theme-status-done': '#a78bfa',
    '--theme-status-done-ring': '#ddd6fe',
    '--theme-status-done-glow': 'rgba(167, 139, 250, 0.4)',
    '--theme-byline-agent': '#f3f4f6',
    '--theme-byline-user': '#7dd3fc',
    '--theme-surface-tint': 'rgba(120, 130, 150, 0.22)',
    '--theme-text-primary': '#e5e7eb',
    '--theme-text-secondary': '#cbd5e1',
    '--theme-text-dim': '#9ca3af',
    '--theme-text-quiet': '#6b7280',
  },
  indigo: {
    '--theme-accent': '#6366f1',
    '--theme-accent-bright': '#818cf8',
    '--theme-accent-glow': 'rgba(129, 140, 248, 0.50)',
    '--theme-accent-soft-bg': 'rgba(129, 140, 248, 0.08)',
    '--theme-accent-soft-border': 'rgba(129, 140, 248, 0.35)',
    '--theme-status-active': '#6366f1',
    '--theme-status-active-ring': '#c7d2fe',
    '--theme-status-active-glow': 'rgba(99, 102, 241, 0.55)',
    '--theme-status-running': '#fb7185',
    '--theme-status-running-ring': '#fecdd3',
    '--theme-status-running-glow': 'rgba(251, 113, 133, 0.60)',
    '--theme-status-next': '#22d3ee',
    '--theme-status-next-ring': '#a5f3fc',
    '--theme-status-next-glow': 'rgba(34, 211, 238, 0.50)',
    '--theme-status-done': '#a78bfa',
    '--theme-status-done-ring': '#ddd6fe',
    '--theme-status-done-glow': 'rgba(167, 139, 250, 0.40)',
    '--theme-byline-agent': '#f3f4f6',
    '--theme-byline-user': '#fbcfe8',
    '--theme-surface-tint': 'rgba(129, 140, 248, 0.22)',
    '--theme-text-primary': '#eef2ff',
    '--theme-text-secondary': '#c7d2fe',
    '--theme-text-dim': '#9ca3af',
    '--theme-text-quiet': '#6b7280',
  },
  amber: {
    '--theme-accent': '#f59e0b',
    '--theme-accent-bright': '#fbbf24',
    '--theme-accent-glow': 'rgba(251, 191, 36, 0.50)',
    '--theme-accent-soft-bg': 'rgba(251, 191, 36, 0.08)',
    '--theme-accent-soft-border': 'rgba(251, 191, 36, 0.35)',
    '--theme-status-active': '#f59e0b',
    '--theme-status-active-ring': '#fde68a',
    '--theme-status-active-glow': 'rgba(245, 158, 11, 0.55)',
    '--theme-status-running': '#ef4444',
    '--theme-status-running-ring': '#fecaca',
    '--theme-status-running-glow': 'rgba(239, 68, 68, 0.55)',
    '--theme-status-next': '#fde047',
    '--theme-status-next-ring': '#fef9c3',
    '--theme-status-next-glow': 'rgba(253, 224, 71, 0.50)',
    '--theme-status-done': '#fb923c',
    '--theme-status-done-ring': '#fed7aa',
    '--theme-status-done-glow': 'rgba(251, 146, 60, 0.45)',
    '--theme-byline-agent': '#fef3c7',
    '--theme-byline-user': '#fde68a',
    '--theme-surface-tint': 'rgba(251, 191, 36, 0.22)',
    '--theme-text-primary': '#fef3c7',
    '--theme-text-secondary': '#fde68a',
    '--theme-text-dim': '#d1d5db',
    '--theme-text-quiet': '#9ca3af',
  },
  slate: {
    '--theme-accent': '#94a3b8',
    '--theme-accent-bright': '#cbd5e1',
    '--theme-accent-glow': 'rgba(203, 213, 225, 0.40)',
    '--theme-accent-soft-bg': 'rgba(203, 213, 225, 0.06)',
    '--theme-accent-soft-border': 'rgba(203, 213, 225, 0.30)',
    '--theme-status-active': '#7dd3fc',
    '--theme-status-active-ring': '#e0f2fe',
    '--theme-status-active-glow': 'rgba(125, 211, 252, 0.45)',
    '--theme-status-running': '#f9a8d4',
    '--theme-status-running-ring': '#fce7f3',
    '--theme-status-running-glow': 'rgba(249, 168, 212, 0.55)',
    '--theme-status-next': '#fcd34d',
    '--theme-status-next-ring': '#fef3c7',
    '--theme-status-next-glow': 'rgba(252, 211, 77, 0.40)',
    '--theme-status-done': '#c4b5fd',
    '--theme-status-done-ring': '#ede9fe',
    '--theme-status-done-glow': 'rgba(196, 181, 253, 0.35)',
    '--theme-byline-agent': '#e5e7eb',
    '--theme-byline-user': '#cbd5e1',
    '--theme-surface-tint': 'rgba(148, 163, 184, 0.22)',
    '--theme-text-primary': '#e5e7eb',
    '--theme-text-secondary': '#cbd5e1',
    '--theme-text-dim': '#94a3b8',
    '--theme-text-quiet': '#64748b',
  },
};

/** Font-size schema. */
export const SIZE_VAR_NAMES = [
  '--fs-title',
  '--fs-button',
  '--fs-body',
  '--fs-meta',
  '--fs-chat',
] as const;

export type SizeVar = (typeof SIZE_VAR_NAMES)[number];

export const SIZE_PRESETS: Record<SizeId, Record<SizeVar, string>> = {
  compact: {
    '--fs-title':  '10px',
    '--fs-button': '11px',
    '--fs-body':   '12px',
    '--fs-meta':   '9.5px',
    '--fs-chat':   '12.5px',
  },
  default: {
    '--fs-title':  '11px',
    '--fs-button': '12px',
    '--fs-body':   '13px',
    '--fs-meta':   '10px',
    '--fs-chat':   '13.5px',
  },
  large: {
    '--fs-title':  '13px',
    '--fs-button': '14px',
    '--fs-body':   '15px',
    '--fs-meta':   '11px',
    '--fs-chat':   '15.5px',
  },
};

/** Curated picks for the per-variable colour-chip row in the picker.
 *  Operator-friendly subset of common tints. */
export const CHAT_USER_COLOR_CHIPS: readonly { hex: string; label: string }[] = [
  { hex: '#7dd3fc', label: 'Sky' },
  { hex: '#fbcfe8', label: 'Pink' },
  { hex: '#fde68a', label: 'Amber' },
  { hex: '#c4b5fd', label: 'Violet' },
  { hex: '#86efac', label: 'Emerald' },
  { hex: '#cbd5e1', label: 'Slate' },
  { hex: '#fda4af', label: 'Rose' },
  { hex: '#5eead4', label: 'Teal' },
];
