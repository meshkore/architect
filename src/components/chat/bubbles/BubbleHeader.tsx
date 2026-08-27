/**
 * BubbleHeader — the byline row above every turn.
 *
 * V86u dropped the rounded card from both bubble kinds, so this row is
 * the only visual anchor separating one turn from the next: agent-id
 * chip + name + HH:MM, then a fading tinted rule that telegraphs which
 * side owns the row, then an optional Stop control at the far end.
 *
 * `tone` changes only the name colour (and the rule's gradient) — id
 * chips stay emerald, timestamps stay gray. Byline colours come from the
 * theme variables so the ThemePicker retones operator-vs-agent without a
 * code change; `cancelled` is a literal red because it is a hard-error
 * state, not a themable tone.
 */

import { Show } from 'solid-js';
import { formatBubbleTs } from './format';

export function BubbleHeader(props: {
  primary: string;
  id?: string;
  ts?: string;
  align: 'left' | 'right';
  tone: 'agent' | 'operator' | 'cancelled';
  suffix?: string;
  /** V89.2 — renders a subtle Stop at the far end of the header line.
   *  Used by the streaming AssistantBubble and PreparingBubble so the
   *  operator can interrupt the turn from the byline row itself. */
  onStop?: () => void;
}) {
  const nameStyle = (): Record<string, string> => {
    if (props.tone === 'cancelled') return { color: '#fca5a5' /* red-300 */ };
    if (props.tone === 'operator') return { color: 'var(--theme-byline-user)' };
    return { color: 'var(--theme-byline-agent)' };
  };
  const fadeStyle = (): Record<string, string> => {
    // The gradient starts on the side adjacent to the byline and fades
    // toward the opposite edge, in the same tone as the name.
    const dir = props.align === 'right' ? 'to left' : 'to right';
    let from: string;
    if (props.tone === 'cancelled') from = 'rgba(248, 113, 113, 0.40)';
    else if (props.tone === 'operator')
      from = 'color-mix(in srgb, var(--theme-byline-user) 50%, transparent)';
    else
      from = 'color-mix(in srgb, var(--theme-byline-agent) 35%, transparent)';
    return { background: `linear-gradient(${dir}, ${from}, transparent)` };
  };
  return (
    <div class={`flex items-center gap-2 text-[11px] w-full ${props.align === 'right' ? 'flex-row-reverse' : ''}`}>
      <Show when={props.id}>
        <span class="font-mono text-[10px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/25 rounded px-1.5 py-0.5 uppercase tracking-wider flex-shrink-0">
          {props.id}
        </span>
      </Show>
      <span class="font-semibold flex-shrink-0" style={nameStyle()}>{props.primary}</span>
      <Show when={props.ts}>
        <span class="font-mono text-[10px] text-gray-600 flex-shrink-0">
          <time dateTime={props.ts}>{formatBubbleTs(props.ts!)}</time>
        </span>
      </Show>
      <Show when={props.suffix}>
        <span class={`font-mono text-[10px] uppercase tracking-wider flex-shrink-0 ${
          props.tone === 'cancelled' ? 'text-red-400/80' : 'text-amber-400/80'
        }`}>
          · {props.suffix}
        </span>
      </Show>
      <span aria-hidden="true" class="flex-1 h-px min-w-[12px]" style={fadeStyle()} />
      <Show when={props.onStop}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); props.onStop?.(); }}
          title="Stop this turn"
          class="flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-red-300/70 hover:text-red-200 border border-red-500/25 hover:border-red-500/55 rounded px-1.5 py-0.5 transition-colors leading-none"
        >
          ■ stop
        </button>
      </Show>
    </div>
  );
}

export default BubbleHeader;
