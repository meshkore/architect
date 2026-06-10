/**
 * AgentCard — single row in the ChatRail.
 *
 * 2026-06-10 operator rewrite ("los quiero más limpios, menos
 * bordes, menos datos, al final me suelo guiar por el nombre"):
 *
 *   - Three responsive layouts based on the rail's chatRailWidth:
 *       wide   (≥160 px): name + status spinner on row 1,
 *                         metadata `type · A001 · • local` on row 2
 *       medium (80-159 px): name + status, metadata `type · A001`
 *       narrow (<80 px):    first 5 chars of the NAME only, big
 *   - Borders are dropped for idle cards. State signalling now uses
 *     a coloured left edge (3 px) + a faint background tint when
 *     selected / review / working — never an outline that competes
 *     with the column's own panel border.
 *   - Type compresses to a single char (the emoji `agentVisualInfo`
 *     already supplies — Coder 🧠, Master 👑, Deploy 🚀, etc.).
 *   - Local vs remote becomes a single character (• filled = local,
 *     ○ open = remote) inline in the metadata row.
 *   - ID `A001` lives only in the metadata row, dim and tiny — the
 *     operator's primary handle is the name.
 *
 * Selection wins over working; review (pending) wins over both;
 * drag-over wins over everything (transient).
 */

import { Show } from 'solid-js';
import type { ConvMeta, AgentStatusKind } from '~/state/chat';
import { agentVisualInfo } from '~/lib/agent-types';

export interface AgentCardProps {
  conv: string;
  meta: ConvMeta;
  active: boolean;
  status: AgentStatusKind;
  pendingReview: boolean;
  stripe: string;
  /** When true (rail < 80 px wide), render the name-letters-only layout. */
  compact?: boolean;
  /** When true (rail < 160 px but ≥ 80 px), drop the location chip and
   *  use a tighter metadata row. */
  medium?: boolean;
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
  // Resolve the visual info (emoji + colour + label) from the conv
  // slug + meta; for `_onboarding_v1` this resolves to Master Architect
  // regardless of stored agent_type.
  const typeInfo = () => agentVisualInfo(props.conv, props.meta);

  const narrowChars = (): string => {
    const t = title().trim();
    // Drop any "A001" prefix accidentally embedded in the title.
    return t.slice(0, 5);
  };

  const cardClasses = (): string => {
    if (props.compact) {
      const base = [
        'group relative w-full text-left',
        'transition-colors cursor-grab active:cursor-grabbing',
        'flex items-center justify-center',
        'rounded font-semibold tracking-tight select-none',
        'py-1.5',
      ];
      if (props.dragging) base.push('opacity-35');
      if (props.dragOver) base.push('ring-1 ring-cyan-400/70');
      if (props.active) base.push('bg-amber-600/85 text-amber-50');
      else if (props.pendingReview) base.push('text-amber-200 bg-amber-400/[0.06]');
      else if (props.status === 'working') base.push('text-emerald-100 bg-emerald-500/10 animate-pulse-soft');
      else base.push('text-gray-200 hover:bg-gray-800/50');
      return base.join(' ');
    }
    const base = [
      'group relative w-full text-left rounded px-2.5 py-1.5',
      'transition-colors flex flex-col gap-0.5 cursor-grab active:cursor-grabbing',
      'border-l-[3px]',
    ];
    if (props.dragging) base.push('opacity-35');
    if (props.dragOver) {
      base.push('border-l-cyan-400 bg-cyan-500/5');
    } else if (props.pendingReview) {
      base.push('border-l-amber-400 bg-amber-400/[0.05]');
    } else if (props.active) {
      base.push('border-l-emerald-400 bg-emerald-500/[0.07]');
    } else if (props.status === 'working') {
      base.push('border-l-emerald-500/70 bg-transparent animate-pulse-soft');
    } else {
      base.push('border-l-transparent hover:bg-gray-800/30');
    }
    return base.join(' ');
  };

  const onClickRow = (): void => props.onSelect(props.conv);
  const onDragStartRow = (e: DragEvent): void => {
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    props.onDragStart(props.conv);
  };
  const onDragOverRow = (e: DragEvent): void => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    props.onDragOver(props.conv, e);
  };
  const onDropRow = (e: DragEvent): void => {
    e.preventDefault();
    props.onDrop(props.conv, e);
  };

  return (
    <button
      type="button"
      draggable={true}
      data-conv={props.conv}
      onClick={onClickRow}
      onDragStart={onDragStartRow}
      onDragEnd={() => props.onDragEnd()}
      onDragOver={onDragOverRow}
      onDragLeave={() => props.onDragLeave(props.conv)}
      onDrop={onDropRow}
      title={`${title()} · ${props.meta.agentId} · ${typeInfo().label} · ${
        isRemote() ? 'remote' : 'local'
      }${props.pendingReview ? ' · review pending' : ''}`}
      class={cardClasses()}
    >
      <Show
        when={!props.compact}
        fallback={<span aria-label={`${title()} ${props.status}`}>{narrowChars()}</span>}
      >
        {/* ROW 1 — name (primary anchor) + status indicator */}
        <span class="flex items-center gap-2 min-w-0">
          <span
            class={`flex-1 min-w-0 text-[13px] leading-tight truncate ${
              props.active ? 'text-gray-50 font-semibold' : 'text-gray-200'
            }`}
          >
            {title()}
          </span>
          <Show
            when={props.status === 'working'}
            fallback={
              <Show when={props.active}>
                <span class="text-[9px] font-mono text-gray-600 flex-shrink-0">idle</span>
              </Show>
            }
          >
            <span
              class="inline-flex items-center flex-shrink-0"
              aria-label="working"
              title="working"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
            </span>
          </Show>
        </span>

        {/* ROW 2 — metadata: type(1 char) · ID dim · local/remote dot.
            In medium mode (rail < 160 px) the location dot is dropped. */}
        <span class="flex items-center gap-1.5 text-[10px] font-mono text-gray-500">
          <span
            aria-hidden="true"
            class="flex-shrink-0"
            style={{ color: typeInfo().color }}
            title={`Agent type: ${typeInfo().label}`}
          >
            {typeInfo().emoji}
          </span>
          <span class="text-gray-600">·</span>
          <span class="text-gray-500 truncate" title={`Agent id ${props.meta.agentId ?? '?'}`}>
            {props.meta.agentId ?? '?'}
          </span>
          <Show when={!props.medium}>
            <span class="text-gray-700">·</span>
            <span
              class="flex-shrink-0"
              title={isRemote() ? 'remote' : 'local'}
              style={{ color: isRemote() ? '#7dd3fc' : '#9ca3af' }}
            >
              {isRemote() ? '○' : '•'} {isRemote() ? 'remote' : 'local'}
            </span>
          </Show>
        </span>
      </Show>
    </button>
  );
}
