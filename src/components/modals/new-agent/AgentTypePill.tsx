import type { AgentType } from '~/state/chat';
import { AGENT_TYPES } from '~/lib/agent-types';

export default function AgentTypePill(props: {
  type: AgentType;
  hero?: boolean;
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
      class="inline-flex items-center gap-1.5 rounded-full bg-[rgba(11,18,32,0.6)] border transition hover:bg-[rgba(11,18,32,0.9)]"
      classList={{
        'px-3 py-1.5 text-[13px]': props.hero,
        'px-2.5 py-1 text-[12px]': !props.hero,
        'text-white': active(),
        'text-gray-300': !active(),
      }}
      /* dynamic: every accent ties to the per-agent-type colour from the registry */
      style={{
        'border-color': active() ? info.color : 'rgba(75,85,99,0.40)',
        'border-left': `3px solid ${info.color}`,
        'box-shadow': active() ? `inset 0 0 0 1px ${info.color}` : 'none',
      }}
    >
      <span aria-hidden="true">{info.emoji}</span>
      <span>{info.label}</span>
    </button>
  );
}
