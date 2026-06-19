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
import { modelShort } from '~/lib/models';

export interface AgentCardProps {
  conv: string;
  meta: ConvMeta;
  active: boolean;
  status: AgentStatusKind;
  pendingReview: boolean;
  stripe: string;
  /** When true (rail < 60 px wide), render the name-letters-only layout. */
  compact?: boolean;
  /** When true (rail < 160 px but ≥ 60 px), drop the location chip and
   *  use a tighter metadata row. */
  medium?: boolean;
  /** 2026-06-13 — raw rail width, so the metadata row can shed pills
   *  progressively (type → +model → +L/R) instead of clipping. */
  railWidth?: number;
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

  // Rail width — drives the "idle" hint visibility (the metadata row now
  // shows model + L/R always; no per-pill width gating).
  const w = (): number => props.railWidth ?? (props.medium ? 130 : 200);

  const cardClasses = (): string => {
    if (props.compact) {
      const base = [
        'group relative w-full text-left',
        'transition-colors cursor-grab active:cursor-grabbing',
        'flex items-center justify-start',
        'tracking-tight select-none',
        'border-l-[3px]',
        'py-1 px-2',
      ];
      if (props.dragging) base.push('opacity-35');
      if (props.dragOver) base.push('border-l-cyan-400 bg-cyan-500/5');
      else if (props.pendingReview) base.push('border-l-amber-400 text-amber-200');
      else if (props.active) base.push('border-l-emerald-400 text-gray-50 font-semibold');
      else if (props.status === 'working') base.push('border-l-emerald-500/70 text-emerald-100 animate-pulse-soft');
      else base.push('border-l-transparent text-gray-200 hover:text-gray-50');
      return base.join(' ');
    }
    const base = [
      'group relative w-full text-left px-2.5 py-1.5',
      'transition-colors flex flex-col gap-1 cursor-grab active:cursor-grabbing',
      'border-l-[3px]',
    ];
    if (props.dragging) base.push('opacity-35');
    if (props.dragOver) {
      base.push('border-l-cyan-400 bg-cyan-500/5');
    } else if (props.pendingReview) {
      base.push('border-l-amber-400');
    } else if (props.active) {
      /* Operator 2026-06-10: selected row has NO background, NO
       * roundness. Just a bright left bar + brighter text/borders
       * (handled in the inline styles below). Elegant, clean. */
      base.push('border-l-emerald-400');
    } else if (props.status === 'working') {
      base.push('border-l-emerald-500/70 animate-pulse-soft');
    } else {
      /* Subtle hover — text lift only, no full-width bg wash.
       * Operator: "no dejar huecos hacia derecha izquierda". */
      base.push('border-l-transparent');
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
        fallback={
          /* Narrow: show AS MUCH of the name as fits, clipped at the edge
           * with NO ellipsis (operator 2026-06-19: "una letra y tres
           * puntos es absurdo — quita los puntos y aprovecha el espacio").
           * Same font-size as the expanded body. */
          <span
            aria-label={`${title()} ${props.status}`}
            style={{ 'font-size': 'var(--fs-body, 13px)', 'text-overflow': 'clip' }}
            class="w-full leading-tight overflow-hidden whitespace-nowrap"
          >
            {title()}
          </span>
        }
      >
        {/* ROW 1 — name (primary anchor) + status indicator */}
        <span class="flex items-center gap-2 min-w-0">
          <span
            class={`flex-1 min-w-0 leading-tight overflow-hidden whitespace-nowrap ${
              props.active ? 'text-gray-50 font-semibold' : 'text-gray-200'
            }`}
            style={{ 'font-size': 'var(--fs-body, 13px)', 'text-overflow': 'clip' }}
          >
            {title()}
          </span>
          <Show
            when={props.status === 'working'}
            fallback={
              /* 2026-06-13 — "idle" text only when there's room (≥150px);
                 below that it steals the name's width → "M..." */
              <Show when={props.active && w() >= 150}>
                <span class="font-mono text-gray-600 flex-shrink-0" style={{ 'font-size': '9px' }}>idle</span>
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

        {/* ROW 2 — metadata pills. 2026-06-19 operator rewrite: drop the
         *  agent-type letter entirely. FIRST column is ALWAYS the model;
         *  then the L/R (local/remote) badge — and L/R is now the COLOURED
         *  cue (emerald = local on this machine, sky = remote). The agent
         *  ID stays internal (navigate by name). */}
        {(() => {
          const pillBorder = props.active
            ? 'rgba(170, 180, 200, 0.65)'
            : 'rgba(75, 85, 99, 0.45)';
          const dimColor = props.active ? '#cbd5e1' : '#9ca3af';
          return (
            <span class="flex items-center gap-1 font-mono overflow-hidden flex-nowrap"
              style={{ 'font-size': 'var(--fs-meta, 10px)' }}
            >
              {/* Model — always the first column. */}
              <span
                class="inline-flex items-center px-1.5 py-px rounded border flex-shrink-0"
                style={{ 'border-color': pillBorder, color: dimColor }}
                title={`Model: ${props.meta.model ?? 'auto'}`}
              >
                {modelShort(props.meta.model)}
              </span>
              {/* Local / Remote — the coloured cue. */}
              <span
                class="inline-flex items-center justify-center px-1.5 py-px rounded border flex-shrink-0"
                style={{
                  color: isRemote() ? '#7dd3fc' : '#34d399',
                  'border-color': pillBorder,
                  'min-width': '16px',
                }}
                title={isRemote() ? 'remote — runs off this machine' : 'local — runs on this machine'}
              >
                {isRemote() ? 'R' : 'L'}
              </span>
            </span>
          );
        })()}
      </Show>
    </button>
  );
}
