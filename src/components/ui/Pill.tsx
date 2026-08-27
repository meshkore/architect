/**
 * Pill / TabButton — the cockpit's bordered mono chip.
 *
 * AX11 (cockpit-excellence). The `font-mono uppercase tracking-wider`
 * bordered-chip idiom appeared 60+ times across 15+ files, plus half a
 * dozen bespoke near-clones (TabPill, ScopePill, StatusBadge, SubTab…),
 * each drifting a little in padding, radius and hover treatment.
 *
 * The API is (tone × state), not a class bag: a caller picks WHAT the
 * chip means, never how it looks. `emerald` is remapped to the live
 * `--theme-accent*` vars by styles/theme-accent-remap.css, so the
 * accent tone follows the operator's theme — that is why accent chips
 * are written with the emerald utilities rather than a literal colour.
 */

import type { JSX } from 'solid-js';

/** Semantic colour of a chip. `accent` follows the active theme. */
export type PillTone = 'accent' | 'neutral' | 'info' | 'warn' | 'danger' | 'violet';

const SIZE = 'px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider';

/** Selected/active treatment — filled tint + matching border. */
const ON: Record<PillTone, string> = {
  accent:  'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  neutral: 'bg-gray-800/60 text-gray-200 border-gray-600/60',
  info:    'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  warn:    'bg-amber-500/15 text-amber-300 border-amber-500/40',
  danger:  'bg-rose-500/15 text-rose-200 border-rose-500/40',
  violet:  'bg-violet-500/15 text-violet-300 border-violet-500/40',
};

/** Idle treatment — transparent, colour only on hover. */
const OFF: Record<PillTone, string> = {
  accent:  'text-gray-500 hover:text-emerald-300 border-transparent',
  neutral: 'text-gray-500 hover:text-gray-300 border-transparent',
  info:    'text-gray-500 hover:text-cyan-300 border-transparent',
  warn:    'text-gray-500 hover:text-amber-300 border-transparent',
  danger:  'text-gray-500 hover:text-rose-300 border-transparent',
  violet:  'text-gray-500 hover:text-violet-300 border-transparent',
};

export function pillClass(tone: PillTone, active: boolean, extra = ''): string {
  return `${SIZE} border transition-colors ${active ? ON[tone] : OFF[tone]} ${extra}`.trim();
}

/** A static chip (a label, not a control). */
export function Pill(props: {
  tone?: PillTone;
  /** Static pills read as "on" by default — they exist to be seen. */
  muted?: boolean;
  title?: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <span
      class={pillClass(props.tone ?? 'neutral', !props.muted, props.class ?? '')}
      title={props.title}
    >
      {props.children}
    </span>
  );
}

