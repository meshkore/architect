/**
 * TabButton — a clickable chip in a group: filter chips, tab strips,
 * scope pickers, view selectors.
 *
 * AX11 (cockpit-excellence). Shares its geometry with `<Pill>` so a
 * static badge and a selectable chip sitting next to each other line
 * up; only the interaction differs.
 */

import type { JSX } from 'solid-js';
import { pillClass, type PillTone } from '~/components/ui/Pill';

export function TabButton(props: {
  active: boolean;
  onClick: () => void;
  tone?: PillTone;
  title?: string;
  disabled?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onClick()}
      disabled={props.disabled}
      title={props.title}
      aria-pressed={props.active}
      class={pillClass(props.tone ?? 'neutral', props.active, `disabled:opacity-40 ${props.class ?? ''}`)}
    >
      {props.children}
    </button>
  );
}

export default TabButton;
