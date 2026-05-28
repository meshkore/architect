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

import { Show, createEffect, createSignal, onMount, type JSX } from 'solid-js';
import type { ChatMsg } from '~/state/chat';
import type { DaemonEvent } from '~/lib/daemon-client';

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
  return (
    <div class="flex flex-col gap-1 items-start">
      <span class="text-[10px] font-mono text-gray-600 flex items-center gap-1.5">
        {props.msg.author || 'coordinator'}
        <Show when={props.msg.streaming}>
          <span class="text-emerald-400">· streaming</span>
        </Show>
        <Show when={props.msg.cancelled}>
          <span class="text-red-400">· cancelled</span>
        </Show>
      </span>
      <div class={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed flex flex-col ${
        props.msg.cancelled
          ? 'bg-red-500/10 text-red-200 border border-red-500/30'
          : 'bg-gray-900/70 text-gray-200 border border-gray-800'
      }`}>
        <CollapsibleText text={props.msg.text} lockExpanded={props.msg.streaming}>
          <Show when={props.msg.streaming}>
            <span class="inline-block w-2 h-3.5 bg-emerald-400 ml-1 align-middle animate-pulse-soft" />
          </Show>
        </CollapsibleText>
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
