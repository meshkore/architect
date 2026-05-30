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
    // V95 — In compact mode the card chrome (border + padding + halo)
    // is dropped entirely. The chip itself becomes the visual state
    // indicator: solid amber square when selected, thin emerald
    // border when idle. This frees the few pixels we need to render
    // the 4-char id (A001) cleanly at column widths down to ~50 px.
    if (props.compact) {
      const base = [
        'group relative w-full text-left',
        'transition-colors cursor-grab active:cursor-grabbing',
        'flex items-center justify-center',
        'p-0',
      ];
      if (props.dragging) base.push('opacity-35');
      if (props.dragOver) base.push('rounded-md ring-1 ring-cyan-400/70');
      return base.join(' ');
    }
    const base = [
      // V107.10 — tighter vertical rhythm (py-1.5 + gap-0.5 vs py-2 +
      // gap-1) since the status row is gone. Each card now occupies
      // ~50 px instead of ~70 px.
      'group relative w-full text-left rounded-md px-2.5 py-1.5',
      'transition-colors flex flex-col gap-0.5 cursor-grab active:cursor-grabbing',
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
          active={props.active}
          pendingReview={props.pendingReview}
        />
      }>
        {/* V107.11 — Operator-driven rewrite. Title was visually
            misaligned with the chip row because the chips had inner
            padding and the title didn't. Now the layout puts the
            primary info (id + title) on row 1 with the working-status
            pegged right, and the secondary metadata (type + location)
            on row 2. Type label shortened (shortLabel: 'Coder', 'DB',
            'Tests', 'Architect') so it fits with the location pill. */}
        <span class="flex items-baseline gap-2 min-w-0">
          <span
            class={`flex-shrink-0 self-center px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-200 ${props.status === 'working' ? 'animate-pulse-soft' : ''}`}
            style={{ background: 'rgba(17,24,39,0.7)', border: `1px solid ${props.stripe}55` }}
          >
            {props.meta.agentId}
          </span>
          <span class={`flex-1 min-w-0 text-[12px] leading-tight truncate ${props.active ? 'text-gray-100' : 'text-gray-300'}`}>
            {title()}
            <Show when={props.meta.model && props.meta.model !== 'auto'}>
              <span class="text-gray-600 font-mono text-[10px]"> · {props.meta.model}</span>
            </Show>
          </span>
          <Show
            when={props.status === 'working'}
            fallback={<span class="text-[9px] font-mono text-gray-600 flex-shrink-0">idle</span>}
          >
            <span
              class="inline-flex items-center gap-0.5 flex-shrink-0 self-center"
              aria-label="working"
              title="working"
            >
              <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft" />
              <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:150ms]" />
              <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:300ms]" />
            </span>
          </Show>
        </span>
        <span class="flex items-center gap-1.5 text-[9px] font-mono">
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded min-w-0 truncate"
            style={{
              color: typeInfo().color,
              'border': `1px solid ${typeInfo().color}44`,
              background: `${typeInfo().color}10`,
            }}
            title={`Agent type: ${typeInfo().label}`}
          >
            <span aria-hidden="true">{typeInfo().emoji}</span>
            <span class="truncate">{typeInfo().shortLabel ?? typeInfo().label}</span>
          </span>
          <span
            class={[
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border flex-shrink-0',
              isRemote()
                ? 'text-blue-300 border-blue-300/35'
                : 'text-gray-400 border-gray-500/30',
            ].join(' ')}
          >
            <span class="w-1 h-1 rounded-full bg-current" />
            {isRemote() ? 'remote' : 'local'}
          </span>
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
function CompactBody(props: {
  agentId: string;
  stripe: string;
  status: AgentStatusKind;
  active: boolean;
  pendingReview: boolean;
}) {
  // V95 — Chip-only layout for the squeezed agents column. The chip
  // is the WHOLE control: no outer card border, no separate status
  // dot (no room at 50 px). Three visual modes:
  //
  //   selected → solid amber-600 bg + amber-50 text (bold). Matches
  //              the operator's request for a "yellow square" instead
  //              of the green halo when the agent is active in the
  //              chat panel. Read instantly at a glance.
  //   working  → emerald border + animated pulse on the whole chip,
  //              so the chip itself signals activity (the legacy
  //              status dot is gone in compact mode).
  //   review   → dashed amber-400 border + amber-100 text.
  //   idle     → thin gray border + emerald-200 text.
  //
  // Geometry: width=100% of the (paddingless) compact card → ~42 px
  // at column=50 px. py-1 + px-1 internal padding leaves ~32 px for
  // the 4-char monospace id — fits A001 / A010 / A100 cleanly.
  const cls = (): string => {
    const base = [
      'inline-flex items-center justify-center w-full',
      'rounded font-mono text-[11px] font-bold tracking-tight',
      'px-1 py-1',
      'transition-colors select-none',
    ];
    if (props.active) {
      base.push('bg-amber-600 text-amber-50');
      return base.join(' ');
    }
    if (props.pendingReview) {
      base.push('border border-dashed border-amber-400/70 text-amber-100 bg-amber-400/5');
      return base.join(' ');
    }
    if (props.status === 'working') {
      base.push('border border-emerald-400/60 text-emerald-100 bg-emerald-500/10 animate-pulse-soft');
      return base.join(' ');
    }
    base.push('border border-gray-700/70 text-emerald-200 bg-gray-950/60 hover:border-emerald-500/40');
    return base.join(' ');
  };
  return (
    <span class={cls()} aria-label={`${props.agentId} ${props.status}`}>
      {props.agentId}
    </span>
  );
}
