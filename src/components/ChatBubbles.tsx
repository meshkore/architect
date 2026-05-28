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
function CollapsibleText(props: { text: string; lockExpanded?: boolean; children?: JSX.Element }) {
  const [expanded, setExpanded] = createSignal(false);
  const [overflows, setOverflows] = createSignal(false);
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
  // Re-measure on every text mutation (covers streaming + edits).
  createEffect(() => { void props.text; queueMicrotask(measure); });

  const collapsedNow = (): boolean => !props.lockExpanded && !expanded() && overflows();
  const showToggle = (): boolean => !props.lockExpanded && overflows();

  return (
    <>
      <div
        ref={bodyEl}
        class="whitespace-pre-wrap overflow-hidden transition-[max-height] duration-150"
        style={{ 'max-height': collapsedNow() ? `${COLLAPSED_MAX_PX}px` : 'none' }}
      >
        {props.text}
        {props.children}
      </div>
      <Show when={showToggle()}>
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

export function UserBubble(props: { msg: ChatMsg; prepend?: boolean }) {
  return (
    <div class="flex flex-col gap-1 items-end">
      <span class="text-[10px] font-mono text-gray-600 flex items-center gap-1.5">
        {props.msg.author || 'operator'}
        <Show when={props.prepend}>
          <span class="text-amber-400/80">· queued (merges into next turn)</span>
        </Show>
      </span>
      <div class={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed flex flex-col ${
        props.prepend
          ? 'bg-amber-500/10 text-amber-100 border border-amber-500/30'
          : 'bg-emerald-500/15 text-emerald-100 border border-emerald-500/30'
      }`}>
        <CollapsibleText text={props.msg.text} />
      </div>
    </div>
  );
}

export function AssistantBubble(props: { msg: ChatMsg }) {
  // V86p — Build the byline from convMeta (operator's agent name +
  // generated A001 id) instead of falling back to msg.author, which
  // is the daemon's identity string (e.g. "MacBook-Pro-de-Ricart-py").
  // The hostname is fine in the timeline ledger; in the chat it
  // looked alien.
  const byline = () => {
    const conv = chatStore.state.activeConv;
    const meta = conv ? chatStore.state.convMeta[conv] : null;
    if (meta) {
      const idLabel = meta.agentId ? `${meta.agentId} · ` : '';
      const name = meta.title || 'agent';
      return `${idLabel}${name}`;
    }
    return props.msg.author || 'coordinator';
  };
  const charCount = () => props.msg.text.length;
  return (
    <div class="flex flex-col gap-1 items-start w-full">
      <span class="text-[10px] font-mono text-gray-600 flex items-center gap-1.5">
        <span class="text-gray-400">{byline()}</span>
        <Show when={props.msg.streaming}>
          <span class="text-emerald-400 inline-flex items-center gap-1">
            ·
            <span class="inline-flex items-center gap-0.5">
              <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft" />
              <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:150ms]" />
              <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:300ms]" />
            </span>
            <span>working · {charCount()} chars</span>
          </span>
        </Show>
        <Show when={props.msg.cancelled}>
          <span class="text-red-400">· cancelled</span>
        </Show>
      </span>
      <div class={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed flex flex-col ${
        props.msg.cancelled
          ? 'bg-red-500/10 text-red-200 border border-red-500/30'
          : props.msg.streaming
            ? 'bg-gray-900/70 text-gray-200 border border-emerald-500/40 shadow-[0_0_0_1px_rgba(52,211,153,0.15),0_0_20px_-6px_rgba(52,211,153,0.45)]'
            : 'bg-gray-900/70 text-gray-200 border border-gray-800'
      }`}>
        <Show
          when={props.msg.streaming}
          fallback={
            <CollapsibleText text={props.msg.text}>
              <Show when={props.msg.cancelled}>
                <span class="text-red-400/80 text-[11px]"> · cancelled</span>
              </Show>
            </CollapsibleText>
          }
        >
          {/* Streaming tail — fixed height, column-reverse so the
              LATEST content sits flush with the bottom edge and older
              lines scroll off the top. Operator sees movement, never
              loses their place. */}
          <StreamingTail text={props.msg.text} />
        </Show>
      </div>
    </div>
  );
}

/**
 * Live streaming preview — clips to the LAST 3 lines of the assistant
 * response while it's writing. column-reverse + overflow:hidden is
 * the canonical CSS recipe for "stick to bottom of overflowing box".
 * The blinking caret rides at the very end of the text so the eye
 * tracks the latest token.
 */
function StreamingTail(props: { text: string }) {
  return (
    <div
      class="overflow-hidden flex flex-col-reverse"
      style={{ 'max-height': `${STREAM_TAIL_HEIGHT_PX}px` }}
    >
      <div class="whitespace-pre-wrap">
        {props.text}
        <span class="inline-block w-2 h-3.5 bg-emerald-400 ml-1 align-middle animate-pulse-soft" />
      </div>
    </div>
  );
}

/**
 * V86p — "Preparing response…" placeholder. Shown when the operator
 * just dispatched a message but no assistant chunk has arrived over
 * the WS yet. Carries an elapsed counter so the operator can tell
 * the difference between "the daemon's thinking" (2-5s typical) and
 * "the daemon is stuck" (>30s).
 */
export function PreparingBubble(props: { dispatchedAt: number }) {
  const [elapsed, setElapsed] = createSignal(0);
  const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - props.dispatchedAt) / 1000)));
  onMount(() => {
    tick();
    const iv = setInterval(tick, 1000);
    onCleanup(() => clearInterval(iv));
  });
  return (
    <div class="flex flex-col gap-1 items-start w-full">
      <span class="text-[10px] font-mono text-gray-600 flex items-center gap-1.5">
        <span class="text-gray-400">coordinator</span>
        <span class="text-emerald-400 inline-flex items-center gap-1">
          ·
          <span class="inline-flex items-center gap-0.5">
            <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft" />
            <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:150ms]" />
            <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:300ms]" />
          </span>
          <span>preparing response · {elapsed()}s</span>
        </span>
      </span>
      <div class="max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed border border-emerald-500/30 bg-gray-900/50 text-gray-400 italic">
        Waiting for the daemon's first chunk…
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
