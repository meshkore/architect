/**
 * AgentCard — single row in the ChatRail.
 *
 * V86n — switched to a border state-machine. Removed the V80 left
 * stripe (the 3px coloured bar on the left edge) because:
 *   - It ate horizontal room from the title.
 *   - The agent-type colour is already visible on the inline chip.
 *   - State signalling now uses the WHOLE border so the eye picks up
 *     selected / working / review / drag-over at a glance.
 *
 * Border states (uniform 1px around, no left stripe):
 *   idle         · gray-800 solid                          · neutral
 *   selected     · emerald-500 solid + bg emerald-500/8    · primary
 *   working      · emerald solid + soft animated halo glow · activity
 *   review       · amber-400 1.5px dashed + bg amber/5     · attention
 *   drag-over    · cyan-400 1.5px dashed + bg cyan-500/5   · transient
 *
 * Review wins over selected (the operator needs to act on it more than
 * they need the active marker); drag-over wins over all (transient).
 */

import { Show } from 'solid-js';
import type { ConvMeta, AgentStatusKind } from '~/state/chat';
import { agentTypeInfo } from '~/lib/agent-types';

export interface AgentCardProps {
  conv: string;
  meta: ConvMeta;
  active: boolean;
  status: AgentStatusKind;
  pendingReview: boolean;
  stripe: string;
  /** V86o — When true, drop the chips + title and render a compact
   *  pill (id + status dot only). Used when the rail width is below
   *  130 px so the card stays readable. */
  compact?: boolean;
  onSelect: (conv: string) => void;
  onDragStart: (conv: string) => void;
  onDragEnd: () => void;
  onDragOver: (conv: string, e: DragEvent) => void;
  onDragLeave: (conv: string) => void;
  onDrop: (conv: string, e: DragEvent) => void;
  dragOver: boolean;
  dragging: boolean;
}

export default function AgentCard(props: AgentCardProps) {
  const isRemote = () => props.meta.location?.type === 'remote';
  const title = () => props.meta.title || props.conv;
  // V86 — the agent-type chip used to live in the chat header. Moved
  // here so the rail card is the canonical place to learn "what kind
  // of agent this is", and the chat header stays compact for the
  // name + actions.
  const typeInfo = () => agentTypeInfo(props.meta.type);

  // V86n — border state-machine. Precedence (highest first):
  //   drag-over  → dashed cyan-400 1.5px + bg cyan-500/5
  //   review     → dashed amber-400 1.5px + bg amber-400/5
  //   selected   → solid emerald-500 + bg emerald-500/10
  //   working    → same border as selected/idle + animated halo
  //   idle       → solid gray-800/70
  // The card is always 1.5px on the border to keep the layout stable
  // when state flips between solid / dashed; idle just uses a duller
  // colour so the eye still distinguishes it from active.
  const cardClasses = (): string => {
    const base = [
      'group relative w-full text-left rounded-md px-2.5 py-2',
      'transition-colors flex flex-col gap-1 cursor-grab active:cursor-grabbing',
      'border-[1.5px]',
    ];
    if (props.dragging) base.push('opacity-35');
    if (props.dragOver) {
      base.push('border-cyan-400/70 bg-cyan-500/5 border-dashed');
    } else if (props.pendingReview) {
      base.push('border-amber-400/75 bg-amber-400/[0.04] border-dashed');
    } else if (props.active) {
      base.push('border-emerald-500/60 bg-emerald-500/10');
    } else {
      base.push('border-gray-800/70 bg-gray-950/60 hover:border-gray-700');
    }
    // Working halo overlays any non-transient state.
    if (props.status === 'working' && !props.dragOver && !props.pendingReview) {
      base.push('shadow-[0_0_0_1px_rgba(52,211,153,0.20),0_0_18px_-4px_rgba(52,211,153,0.55)] animate-pulse-soft');
    }
    return base.join(' ');
  };

  return (
    <button
      type="button"
      draggable={true}
      data-conv={props.conv}
      onClick={() => props.onSelect(props.conv)}
      onDragStart={(e) => {
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        props.onDragStart(props.conv);
      }}
      onDragEnd={() => props.onDragEnd()}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        props.onDragOver(props.conv, e);
      }}
      onDragLeave={() => props.onDragLeave(props.conv)}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop(props.conv, e);
      }}
      title={`${title()} · ${props.meta.agentId} · ${props.meta.location?.type ?? 'local'}${props.pendingReview ? ' · review pending' : ''}`}
      class={cardClasses()}
    >
      <Show when={!props.compact} fallback={
        <CompactBody
          agentId={props.meta.agentId ?? '?'}
          stripe={props.stripe}
          status={props.status}
        />
      }>
        <span class="flex items-center gap-1.5 text-[10px] font-mono">
          <span
            class={`px-1.5 py-0.5 rounded text-gray-200 flex-shrink-0 ${props.status === 'working' ? 'animate-pulse-soft' : ''}`}
            /* dynamic: border tint derived from props.stripe */
            style={{ background: 'rgba(17,24,39,0.7)', border: `1px solid ${props.stripe}55` }}
          >
            {props.meta.agentId}
          </span>
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] min-w-0 truncate"
            style={{
              color: typeInfo().color,
              'border': `1px solid ${typeInfo().color}44`,
              background: `${typeInfo().color}10`,
            }}
            title={`Agent type: ${typeInfo().label}`}
          >
            <span aria-hidden="true">{typeInfo().emoji}</span>
            <span class="truncate">{typeInfo().label}</span>
          </span>
          <span
            class={[
              'ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] flex-shrink-0',
              isRemote()
                ? 'text-blue-300 border-blue-300/35'
                : 'text-gray-400 border-gray-500/30',
            ].join(' ')}
          >
            <span class="w-1 h-1 rounded-full bg-current" />
            {isRemote() ? 'remote' : 'local'}
          </span>
        </span>
        <span class={`text-[12px] leading-tight truncate ${props.active ? 'text-gray-100' : 'text-gray-300'}`}>
          {title()}
          <Show when={props.meta.model && props.meta.model !== 'auto'}>
            <span class="text-gray-600 font-mono text-[10px]"> · {props.meta.model}</span>
          </Show>
        </span>
        <span class="text-[10px] font-mono text-gray-500 flex items-center gap-1.5">
          <Show
            when={props.status === 'working'}
            fallback={<span class="text-gray-600">idle</span>}
          >
            <span class="inline-flex items-center gap-0.5">
              <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft" />
              <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:150ms]" />
              <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:300ms]" />
            </span>
            <span class="text-emerald-300">working</span>
          </Show>
        </span>
      </Show>
    </button>
  );
}

/**
 * V86o — Slim layout for the collapsed rail (<130 px wide). Drops the
 * full info chips + title and shows only the id pill + a status dot
 * to its right. The card's border state-machine still conveys
 * selected / review / drag-over visually, so the operator doesn't
 * lose context. Hovering the row surfaces the full title via the
 * parent button's `title` attribute.
 */
function CompactBody(props: { agentId: string; stripe: string; status: AgentStatusKind }) {
  return (
    <span class="flex items-center justify-between gap-1.5 text-[10px] font-mono min-w-0">
      <span
        class="px-1.5 py-0.5 rounded text-gray-200 flex-shrink-0 truncate"
        style={{ background: 'rgba(17,24,39,0.7)', border: `1px solid ${props.stripe}55` }}
      >
        {props.agentId}
      </span>
      <span
        class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          props.status === 'working'
            ? 'bg-emerald-400 animate-pulse-soft'
            : 'bg-gray-600'
        }`}
        aria-label={props.status}
        title={props.status}
      />
    </span>
  );
}
