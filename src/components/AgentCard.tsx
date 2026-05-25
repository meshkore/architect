/**
 * AgentCard — single row in the ChatRail.
 *
 * Mirrors the V80 monolith's .agent-card markup: left stripe coloured by
 * agent type, id chip + model + location chip on the head row, title on
 * the body row, and a status line (idle / working with animated dots).
 * Pending-review ring is the V45 yellow-dashed outline; we render the
 * outer ::after via a Tailwind ring* class to stay CSS-free.
 */

import { Show } from 'solid-js';
import type { ConvMeta, AgentStatusKind } from '~/state/chat';

export interface AgentCardProps {
  conv: string;
  meta: ConvMeta;
  active: boolean;
  status: AgentStatusKind;
  pendingReview: boolean;
  stripe: string;
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
      class={[
        'group relative w-full text-left rounded-md border pl-2.5 pr-2 py-2',
        'transition-colors flex flex-col gap-1 cursor-grab active:cursor-grabbing',
        props.active
          ? 'bg-emerald-500/10 border-emerald-500/45'
          : 'bg-gray-950/60 border-gray-800/70 hover:border-gray-700',
        props.dragging ? 'opacity-35' : '',
        props.dragOver ? '!border-emerald-500/55 !bg-emerald-500/5' : '',
        props.pendingReview ? 'ring-1 ring-amber-400/70 ring-offset-0' : '',
      ].join(' ')}
      /* dynamic: stripe colour comes from agent-type registry (props.stripe) */
      style={{ 'border-left': `3px solid ${props.stripe}` }}
    >
      <span class="flex items-center gap-1.5 text-[10px] font-mono">
        <span
          class={`px-1.5 py-0.5 rounded text-gray-200 ${props.status === 'working' ? 'animate-pulse-soft' : ''}`}
          /* dynamic: border tint derived from props.stripe */
          style={{ background: 'rgba(17,24,39,0.7)', border: `1px solid ${props.stripe}55` }}
        >
          {props.meta.agentId}
        </span>
        <span class="text-gray-500 truncate">{props.meta.model || 'auto'}</span>
        <span
          class={[
            'ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px]',
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
    </button>
  );
}
