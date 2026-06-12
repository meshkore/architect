import type { AgentType } from '~/state/chat';
import { AGENT_TYPES } from '~/lib/agent-types';

/**
 * AgentTypePill — one type choice in the New Agent modal.
 *
 * 2026-06-13 operator redesign: "quita esos bordes redondeados de
 * colores… solo rectángulos de bordes rectos, en una sola línea."
 * Straight-edged rectangle (no rounded-full, no per-type colored
 * ring). A thin left tick keeps the type's colour as the only accent;
 * the active chip uses the app's emerald, not the per-type hue, so the
 * row reads as one coherent control instead of a rainbow.
 */
export default function AgentTypePill(props: {
  type: AgentType;
  picked: AgentType;
  onPick: (t: AgentType) => void;
}) {
  const info = AGENT_TYPES[props.type];
  const active = () => props.picked === props.type;
  return (
    <button
      type="button"
      onClick={() => props.onPick(props.type)}
      aria-pressed={active()}
      title={info.label}
      class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] border-l-2 border-y border-r transition flex-shrink-0 min-w-0"
      classList={{
        'bg-emerald-500/12 border-emerald-500/60 text-white': active(),
        'bg-[rgba(11,18,32,0.5)] border-gray-700/40 text-gray-300 hover:bg-[rgba(11,18,32,0.85)] hover:text-gray-100': !active(),
      }}
      /* The only per-type colour: the 2px left tick. */
      style={{ 'border-left-color': info.color }}
    >
      <span aria-hidden="true" class="flex-shrink-0">{info.emoji}</span>
      <span class="truncate">{info.label}</span>
    </button>
  );
}
