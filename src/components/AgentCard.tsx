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

  const narrowChars = (): string => title().trim().slice(0, 3);

  /** 1-2 character abbreviation derived from the agent type's
   *  `shortLabel` (or `label`). Replaces the emoji in the metadata
   *  row — operator field report 2026-06-10: "el icono amarillo,
   *  rosita de la barra no me gusta nada, usa una letra o 2."
   *  Rule: ≤2-char labels (e.g. "DB") kept verbatim and uppercased;
   *  longer labels collapse to their first letter uppercased.
   *  Single letters are easier to scan than emojis at this size. */
  const typeInitials = (): string => {
    const src = (typeInfo().shortLabel ?? typeInfo().label).trim();
    if (!src) return '·';
    if (src.length <= 2) return src.toUpperCase();
    return src[0]!.toUpperCase();
  };

  const cardClasses = (): string => {
    if (props.compact) {
      const base = [
        'group relative w-full text-left',
        'transition-colors cursor-grab active:cursor-grabbing',
        'flex items-center justify-center',
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
          /* Narrow: 3-char truncation of the NAME at the SAME font-size
           * as the expanded body — operator 2026-06-10: "la columna de
           * agentes debe seguir con la mismo tamaño de fuente al
           * reducirse. Dejemos 3 letras minimo." */
          <span
            aria-label={`${title()} ${props.status}`}
            style={{ 'font-size': 'var(--fs-body, 13px)' }}
            class="leading-tight"
          >
            {narrowChars()}
          </span>
        }
      >
        {/* ROW 1 — name (primary anchor) + status indicator */}
        <span class="flex items-center gap-2 min-w-0">
          <span
            class={`flex-1 min-w-0 leading-tight truncate ${
              props.active ? 'text-gray-50 font-semibold' : 'text-gray-200'
            }`}
            style={{ 'font-size': 'var(--fs-body, 13px)' }}
          >
            {title()}
          </span>
          <Show
            when={props.status === 'working'}
            fallback={
              <Show when={props.active}>
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

        {/* ROW 2 — metadata pills. 2026-06-12 operator rewrite: the
         *  agent ID (A001…) is HIDDEN from the rail — the operator
         *  navigates by name; the ID stays internal (diaries, logs,
         *  WS). Pills now show: type letter · MODEL (short) · L/R.
         *  "local"/"remote" collapse to single chars L / R. */}
        {(() => {
          const pillBorder = props.active
            ? 'rgba(170, 180, 200, 0.65)'
            : 'rgba(75, 85, 99, 0.45)';
          const dimColor = props.active ? '#cbd5e1' : '#9ca3af';
          return (
            <span class="flex items-center gap-1 font-mono"
              style={{ 'font-size': 'var(--fs-meta, 10px)' }}
            >
              <span
                class="inline-flex items-center justify-center flex-shrink-0 px-1.5 py-px rounded border"
                style={{
                  color: typeInfo().color,
                  'border-color': pillBorder,
                  'min-width': '16px',
                }}
                title={`Agent type: ${typeInfo().label}`}
              >
                {typeInitials()}
              </span>
              <span
                class="inline-flex items-center px-1.5 py-px rounded border flex-shrink-0"
                style={{ 'border-color': pillBorder, color: dimColor }}
                title={`Model: ${props.meta.model ?? 'auto'}`}
              >
                {modelShort(props.meta.model)}
              </span>
              <Show when={!props.medium}>
                <span
                  class="inline-flex items-center justify-center px-1.5 py-px rounded border flex-shrink-0"
                  style={{
                    color: isRemote()
                      ? '#7dd3fc'
                      : (props.active ? '#cbd5e1' : '#9ca3af'),
                    'border-color': pillBorder,
                    'min-width': '16px',
                  }}
                  title={isRemote() ? 'remote' : 'local'}
                >
                  {isRemote() ? 'R' : 'L'}
                </span>
              </Show>
            </span>
          );
        })()}
      </Show>
    </button>
  );
}
