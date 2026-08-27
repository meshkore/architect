/**
 * IconButton — a small square control whose whole label is a glyph.
 *
 * AX11 (cockpit-excellence). `aria-label` is REQUIRED, not optional:
 * every hand-rolled icon button in the cockpit that omitted it left a
 * screen reader announcing "button". Making it part of the type is the
 * cheapest way to stop that regressing.
 */

import type { JSX } from 'solid-js';

export type IconTone = 'neutral' | 'accent' | 'danger';

const TONE: Record<IconTone, string> = {
  neutral: 'text-gray-400 hover:text-gray-100 border-gray-700/50 hover:border-gray-500/60',
  accent:  'text-emerald-300 hover:text-emerald-200 border-emerald-500/30 hover:border-emerald-500/60',
  danger:  'text-red-300 hover:text-red-200 border-red-500/30 hover:border-red-500/60',
};

export function IconButton(props: {
  onClick: (e: MouseEvent) => void;
  /** Announced to assistive tech; also the default tooltip. */
  label: string;
  title?: string;
  tone?: IconTone;
  disabled?: boolean;
  /** Drop the border/padding — for glyphs that sit inline in dense rows. */
  bare?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      onClick={(e) => props.onClick(e)}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.title ?? props.label}
      class={`inline-flex items-center justify-center transition-colors disabled:opacity-40 ${
        props.bare ? '' : 'rounded border px-2 py-1'
      } ${TONE[props.tone ?? 'neutral']} ${props.class ?? ''}`}
    >
      {props.children}
    </button>
  );
}

export default IconButton;
