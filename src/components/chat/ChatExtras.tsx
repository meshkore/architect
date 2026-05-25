import { agentTypeInfo } from '~/lib/agent-types';
import type { AgentType } from '~/state/chat';

export function StopBar(props: { cancelling: boolean; onStop: () => void }) {
  return (
    <div class="px-3 pt-2 flex justify-end border-t border-gray-800/60">
      <button
        type="button"
        onClick={props.onStop}
        disabled={props.cancelling}
        class="px-3 py-1 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 font-semibold text-[11px] transition-colors disabled:opacity-60"
        title="Stop the coordinator. The pending buffer is dropped."
      >{props.cancelling ? 'stopping…' : 'Stop'}</button>
    </div>
  );
}

export function AgentRoleHint(props: { type: AgentType }) {
  const info = () => agentTypeInfo(props.type);
  return (
    <div
      class="mx-3 mb-3 px-3 py-2 rounded-md border text-[11px] leading-snug text-gray-300"
      /* dynamic: tinted with the agent-type colour from the registry */
      style={{
        'border-color': `${info().color}40`,
        background: `${info().color}10`,
      }}
    >
      {/* dynamic: same agent-type colour */}
      <span class="font-mono text-[10px] mr-1" style={{ color: info().color }}>
        {info().emoji} {info().label} —
      </span>
      <span>{info().role}</span>
    </div>
  );
}

export function EmptyChat() {
  return (
    <div class="flex-1 flex items-center justify-center p-8">
      <p class="text-center text-xs text-gray-600 max-w-xs">
        Pick an agent in the rail on the left, or click ＋ to start a new conversation.
      </p>
    </div>
  );
}
