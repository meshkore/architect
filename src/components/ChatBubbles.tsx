/**
 * ChatBubbles — leaf renderers for the chat thread.
 *
 * MessageBubble dispatches on kind. UserBubble / AssistantBubble are
 * the two "speech" variants. ToolUseBubble + TaskLifecycleBubble render
 * the structured events the daemon emits alongside chat text
 * (tool.use / tool.result / task.created / task.transition / task.cancelled).
 *
 * The store-side chat layer only carries chat.* — tool/task bubbles
 * receive a normalised payload from ChatPanel which folds the relevant
 * store.events() entries into the message stream by ts.
 */

import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { chatStore, type ChatMsg } from '~/state/chat';
import { ensureMarked } from '~/lib/cdn-loaders';
import { log } from '~/lib/log';
import type { DaemonEvent } from '~/lib/daemon-client';

/**
 * V86p — Live streaming window. While the daemon is still writing,
 * the assistant bubble shows only the LATEST 3 lines of output via a
 * fixed-height clip + `flex-direction: column-reverse` (the standard
 * CSS trick to keep the bottom of overflowing content visible). This
 * is "muestrame que la gente está trabajando aunque no veamos mucho
 * detalle" — the operator sees movement at all times, doesn't lose
 * scroll position to a growing wall of text. The full text reflows
 * the moment `streaming` flips to false (see AssistantBubble).
 */
const STREAM_TAIL_HEIGHT_PX = 84;

/**
 * V86o — collapse threshold for long messages, in px. Chosen to leave
 * roughly 4 visible lines at text-sm leading-relaxed (line-height
 * ≈ 1.625 × 14 ≈ 23 px → 4 lines ≈ 92 px). Slightly above so the
 * "show more" toggle only kicks in for genuinely long content.
 */
const COLLAPSED_MAX_PX = 96;

/**
 * Collapsible text wrapper. Renders text up to COLLAPSED_MAX_PX tall
 * by default; if the content overflows, surfaces a "+ show more"
 * toggle directly below. Expanded state unclamps + flips to
 * "— show less". Re-measures on every text update so streaming
 * messages get the toggle once they cross the threshold.
 *
 * When `lockExpanded` is true (assistant streaming in-flight), the
 * component skips collapse entirely — operators want to watch text
 * grow, not see it clipped.
 */
function CollapsibleText(props: { text: string; lockExpanded?: boolean; markdown?: boolean; children?: JSX.Element }) {
  const [expanded, setExpanded] = createSignal(false);
  const [overflows, setOverflows] = createSignal(false);
  // V86r — Markdown rendering for assistant responses. The daemon
  // streams plain text that's actually markdown (headings, tables,
  // bold, lists, code fences). The vanilla V80 monolith rendered it
  // with marked; the Solid port had been dumping raw text into
  // <whitespace-pre-wrap>, so tables and bold landed as literal `**`
  // / `|---|`. Now we parse with marked the SAME way ContextPanel /
  // Diary / Protocols do. User bubbles stay plain on purpose (their
  // input is plain text, not markdown).
  const [html, setHtml] = createSignal<string | null>(null);
  createEffect(() => {
    const t = props.text;
    if (!props.markdown) { setHtml(null); return; }
    // ensureMarked is CDN-loaded; cached after first call.
    void ensureMarked().then((m) => {
      try {
        setHtml(m.parse(t, { gfm: true }));
      } catch (e) {
        log.warn('chat marked render failed', e instanceof Error ? e.message : String(e));
        setHtml(null);
      }
    }).catch((e) => {
      log.warn('chat ensureMarked failed', e instanceof Error ? e.message : String(e));
      setHtml(null);
    });
  });

  let bodyEl: HTMLDivElement | undefined;

  const measure = (): void => {
    if (!bodyEl) return;
    // Snapshot the inline cap, lift it briefly to read scrollHeight,
    // then restore. Avoids the overflow check colliding with the
    // CSS max-height we already set on the element.
    const prevMax = bodyEl.style.maxHeight;
    bodyEl.style.maxHeight = 'none';
    const full = bodyEl.scrollHeight;
    bodyEl.style.maxHeight = prevMax;
    setOverflows(full > COLLAPSED_MAX_PX + 2);
  };

  onMount(measure);
  // Re-measure on every text mutation (covers streaming + edits + the
  // marked render lifecycle since the parsed HTML lands async).
  createEffect(() => { void props.text; void html(); queueMicrotask(measure); });

  const collapsedNow = (): boolean => !props.lockExpanded && !expanded() && overflows();
  const showToggle = (): boolean => !props.lockExpanded && overflows();

  return (
    <>
      <Show
        when={props.markdown && html() !== null}
        fallback={
          <div
            ref={(el) => { if (!props.markdown) bodyEl = el; }}
            class="whitespace-pre-wrap overflow-hidden transition-[max-height] duration-150"
            style={{ 'max-height': collapsedNow() ? `${COLLAPSED_MAX_PX}px` : 'none' }}
          >
            {props.text}
            {props.children}
          </div>
        }
      >
        {/* Rendered markdown lives in a separate node so the prose
            classes apply only to the assistant's structured output;
            the inline streaming caret (children) rides outside the
            markdown root so it doesn't get reflowed. */}
        <div
          ref={(el) => { bodyEl = el; }}
          class="md prose prose-invert prose-sm max-w-none overflow-hidden transition-[max-height] duration-150"
          style={{ 'max-height': collapsedNow() ? `${COLLAPSED_MAX_PX}px` : 'none' }}
          innerHTML={html() ?? ''}
        />
        {props.children}
      </Show>
      <Show when={showToggle()}>
        {/* V86z — pale-gray fade line right above the toggle when the
            content is clamped. Without it the cut looks like a
            floating / unfinished paragraph; with it the operator
            reads "this text was deliberately trimmed". Hidden once
            expanded — at that point nothing is clipped so a fade
            would be misleading. */}
        <Show when={!expanded()}>
          <span aria-hidden="true" class="block h-px w-full bg-gradient-to-r from-gray-400/40 to-transparent mt-0.5" />
        </Show>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded()); }}
          class="mt-1.5 self-start text-[10px] font-mono uppercase tracking-wider text-emerald-300/70 hover:text-emerald-200 transition-colors"
        >
          {expanded() ? '— show less' : '+ show more'}
        </button>
      </Show>
    </>
  );
}

export function MessageBubble(props: { msg: ChatMsg; prepend?: boolean }) {
  return props.msg.kind === 'user'
    ? <UserBubble msg={props.msg} prepend={props.prepend} />
    : <AssistantBubble msg={props.msg} />;
}

/**
 * V86u — Shared bubble header. Renders the agent id chip + name (or
 * just the operator label) and a HH:MM timestamp. Removed the
 * surrounding rounded card from both bubble kinds, so the header is
 * the only visual anchor that separates one turn from the next.
 *
 * `tone` only changes the name colour — id chips stay emerald,
 * timestamps stay gray. Keeping the chrome minimal is the whole
 * point of the V86u refactor.
 */
function BubbleHeader(props: {
  primary: string;
  id?: string;
  ts?: string;
  align: 'left' | 'right';
  tone: 'agent' | 'operator' | 'cancelled';
  suffix?: string;
}) {
  // V86y — color stops for the fade line. Picked per tone so the
  // line reads as "this is the same speaker's territory" without
  // having to chase the byline text colour exactly.
  const nameColor = (): string => {
    if (props.tone === 'cancelled') return 'text-red-300';
    if (props.tone === 'operator') return 'text-emerald-300';
    return 'text-gray-100';
  };
  const fadeClasses = (): string => {
    // The gradient starts from the side ADJACENT to the byline
    // (where the chip + name sit) and fades toward the opposite edge.
    // For an agent (align=left), the line extends rightward;
    // for the operator (align=right), it extends leftward.
    const direction = props.align === 'right' ? 'bg-gradient-to-l' : 'bg-gradient-to-r';
    const tint =
      props.tone === 'cancelled' ? 'from-red-400/40'
      : props.tone === 'operator' ? 'from-emerald-400/45'
      : 'from-emerald-400/35';
    return `${direction} ${tint} to-transparent`;
  };
  return (
    <div class={`flex items-center gap-2 text-[11px] w-full ${props.align === 'right' ? 'flex-row-reverse' : ''}`}>
      <Show when={props.id}>
        <span class="font-mono text-[10px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/25 rounded px-1.5 py-0.5 uppercase tracking-wider flex-shrink-0">
          {props.id}
        </span>
      </Show>
      <span class={`font-semibold flex-shrink-0 ${nameColor()}`}>{props.primary}</span>
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
      {/* V86y — fading separator. Fills remaining width so each turn
          carries a soft tinted underline that telegraphs which side
          owns the row at a glance, beyond just the alignment. */}
      <span aria-hidden="true" class={`flex-1 h-px min-w-[12px] ${fadeClasses()}`} />
    </div>
  );
}

function formatBubbleTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const hhmm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return hhmm;
    const dm = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
    return `${dm} · ${hhmm}`;
  } catch {
    return ts;
  }
}

export function UserBubble(props: { msg: ChatMsg; prepend?: boolean }) {
  // V86y — "Usuario" replaces the legacy "architect" author tag
  // (which was the dispatch-time hardcoded value, not a person).
  // If the daemon ever exposes an operator-name field via /health
  // or cluster.yaml we can swap this for that value; for now the
  // fixed "Usuario" string matches the operator's request.
  const label = (): string => {
    const a = props.msg.author?.trim();
    if (a && a !== 'architect' && a !== 'operator' && a !== 'user') return a;
    return 'Usuario';
  };
  return (
    <div class="flex flex-col gap-1.5 items-end w-full">
      <BubbleHeader
        primary={label()}
        ts={props.msg.ts}
        align="right"
        tone="operator"
        suffix={props.prepend ? 'queued · merges into next turn' : undefined}
      />
      <div class={`max-w-[85%] text-sm leading-relaxed text-right pr-2 ${
        props.prepend ? 'text-amber-200/95' : 'text-emerald-200/95'
      }`}>
        <CollapsibleText text={props.msg.text} />
      </div>
    </div>
  );
}

export function AssistantBubble(props: { msg: ChatMsg }) {
  // V86u — borderless. Agent replies read as continuous prose with a
  // bold byline (A001 chip + agent name) and a timestamp. The body
  // is rendered markdown (`.md prose`) — headings, tables, code all
  // styled by the existing prose classes, no surrounding card.
  const meta = () => {
    const conv = chatStore.state.activeConv;
    return conv ? chatStore.state.convMeta[conv] : null;
  };
  const agentId = () => meta()?.agentId ?? null;
  const agentName = () => meta()?.title || props.msg.author || 'coordinator';
  return (
    <div class="flex flex-col gap-1.5 items-start w-full">
      <BubbleHeader
        primary={agentName()}
        id={agentId() ?? undefined}
        ts={props.msg.ts}
        align="left"
        tone={props.msg.cancelled ? 'cancelled' : 'agent'}
        suffix={props.msg.cancelled ? 'cancelled' : undefined}
      />
      <div class={`text-sm leading-relaxed max-w-[90%] pl-2 ${
        props.msg.cancelled ? 'text-red-300/95' : 'text-gray-200'
      }`}>
        <Show
          when={props.msg.streaming}
          fallback={
            <CollapsibleText text={props.msg.text} markdown>
              <Show when={props.msg.cancelled}>
                <span class="text-red-400/80 text-[11px]"> · cancelled</span>
              </Show>
            </CollapsibleText>
          }
        >
          {/* V86s — Empty-streaming → ThinkingPlaceholder; populated
              streaming → tail clamp showing the latest 3 lines. The
              "working" badge no longer rides the byline; the rail's
              agent card already says "working", and the operator
              wants the activity signal INSIDE the bubble. */}
          <Show when={props.msg.text.trim().length > 0} fallback={<ThinkingPlaceholder />}>
            <StreamingTail text={props.msg.text} />
          </Show>
        </Show>
      </div>
    </div>
  );
}

/**
 * V86s — Animated "thinking / working / generating" loader. Rotates
 * through three verbs every ~1.8s so the operator gets continuous
 * motion in the bubble body while the daemon is still preparing the
 * first chunk. No caret bar — the user explicitly asked for words,
 * not lines.
 */
const THINKING_VERBS = ['Pensando', 'Trabajando', 'Generando respuesta', 'Procesando'] as const;
function ThinkingPlaceholder() {
  const [idx, setIdx] = createSignal(0);
  onMount(() => {
    const iv = setInterval(() => setIdx((i) => (i + 1) % THINKING_VERBS.length), 1800);
    onCleanup(() => clearInterval(iv));
  });
  return (
    <div class="flex items-center gap-2 text-emerald-300/90 italic">
      <span class="inline-flex items-center gap-0.5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:200ms]" />
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:400ms]" />
      </span>
      <span class="transition-opacity duration-300">{THINKING_VERBS[idx()]}…</span>
    </div>
  );
}

/**
 * Live streaming preview — clips to the LAST 3 lines of the assistant
 * response. column-reverse + overflow:hidden keeps the bottom of the
 * overflowing content visible. No caret bar — once real text starts
 * landing, the operator follows the words, not a green stripe.
 */
function StreamingTail(props: { text: string }) {
  return (
    <div
      class="overflow-hidden flex flex-col-reverse"
      style={{ 'max-height': `${STREAM_TAIL_HEIGHT_PX}px` }}
    >
      <div class="whitespace-pre-wrap">{props.text}</div>
    </div>
  );
}

/**
 * V86s — Renamed from "PreparingBubble". Renders exactly like an
 * assistant bubble in the streaming-with-empty-text state: same
 * byline (A001 · Master from convMeta), same shell, same glow,
 * `<ThinkingPlaceholder>` in the body. The hand-off to the real
 * assistant bubble (once the first chunk lands) is visually
 * seamless — the bubble keeps its position, just swaps placeholder
 * → tail.
 */
export function PreparingBubble(_props: { dispatchedAt: number }) {
  const meta = () => {
    const conv = chatStore.state.activeConv;
    return conv ? chatStore.state.convMeta[conv] : null;
  };
  return (
    <div class="flex flex-col gap-1.5 items-start w-full">
      <BubbleHeader
        primary={meta()?.title || 'coordinator'}
        id={meta()?.agentId ?? undefined}
        ts={undefined}
        align="left"
        tone="agent"
      />
      <div class="max-w-[90%] text-sm leading-relaxed pl-2">
        <ThinkingPlaceholder />
      </div>
    </div>
  );
}

export function ToolUseBubble(props: { ev: DaemonEvent }) {
  const isResult = props.ev.type === 'tool.result';
  const name = String(props.ev['name'] ?? props.ev['tool'] ?? 'tool');
  const summary = String(props.ev['summary'] ?? props.ev['text'] ?? '').slice(0, 240);
  return (
    <div class="flex flex-col gap-1 items-start">
      <span class="text-[10px] font-mono text-gray-600">
        {isResult ? '↳ ' : '⚙ '}{name}
      </span>
      <div class={`max-w-[90%] rounded-md px-3 py-1.5 text-xs font-mono leading-snug whitespace-pre-wrap border ${
        isResult
          ? 'bg-sky-500/5 text-sky-200/90 border-sky-500/25'
          : 'bg-violet-500/5 text-violet-200/90 border-violet-500/25'
      }`}>
        {summary || (isResult ? '(empty result)' : '(no args)')}
      </div>
    </div>
  );
}

export function TaskLifecycleBubble(props: { ev: DaemonEvent }) {
  const t = String(props.ev.type);
  const id = String(props.ev['id'] ?? props.ev['task'] ?? '');
  const label = t === 'task.created' ? 'created'
    : t === 'task.transition' ? `→ ${String(props.ev['status'] ?? '?')}`
    : t === 'task.cancelled' ? 'cancelled'
    : t.replace('task.', '');
  return (
    <div class="flex items-center gap-2 text-[11px] font-mono text-gray-500 self-center">
      <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/70" />
      <span class="text-amber-300/80">{id || 'task'}</span>
      <span class="text-gray-500">{label}</span>
    </div>
  );
}
