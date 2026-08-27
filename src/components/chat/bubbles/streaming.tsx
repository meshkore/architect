/**
 * The three in-flight states of an agent turn.
 *
 *   ThinkingPlaceholder — streaming started, no text yet.
 *   StreamingTail       — text arriving; shows the last ~6 lines.
 *   StreamingIdleHint   — text present but nothing new for >1.5 s.
 *
 * The verbs rotate every 1.8 s. V105 widened the pool from 6 to 36 so a
 * long pause looks like progress instead of a 3-state loader: a full lap
 * now takes ~65 s.
 */

import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { chatStore } from '~/state/chat';
import { ensureMarked } from '~/lib/cdn-loaders';
import { colorizeInlineCodeInHtml } from '~/lib/code-colorize';

/**
 * V86p/2026-06-12 — live streaming window, ~6 lines at 12px/1.55. The
 * operator's rule: "mientras trabaja y genera output dejamos ver de 5 a
 * 6 líneas; cuando tenemos el sumario final, se formatea y se presenta
 * completo." The live render stays light — only the final goes through
 * CollapsibleText.
 */
const STREAM_TAIL_HEIGHT_PX = 112;
const VERB_ROTATE_MS = 1800;
const IDLE_HINT_MS = 1500;

const THINKING_VERBS = [
  'Thinking',
  'Working',
  'Researching',
  'Planning',
  'Generating response',
  'Processing',
  'Reading the briefing',
  'Loading context',
  'Consulting role memory',
  'Cross-referencing',
  'Reviewing the roadmap',
  'Parsing the task',
  'Checking dependencies',
  'Inspecting the cluster state',
  'Reading the code',
  'Composing reply',
  'Mapping the modules',
  'Choosing the right sub-agent',
  'Drafting a plan',
  'Coordinating agents',
  'Calling a tool',
  'Verifying the result',
  'Splitting the work',
  'Identifying the scope',
  'Recapping progress',
  'Resolving references',
  'Cross-checking facts',
  'Stitching the answer',
  'Watching the worker',
  'Asking the daemon',
  'Polling for changes',
  'Reviewing the diff',
  'Picking next step',
  'Drafting a summary',
  'Catching its breath',
  'Almost there',
] as const;

/** Index into THINKING_VERBS, advancing on its own interval. */
function useRotatingVerb(): () => string {
  const [idx, setIdx] = createSignal(0);
  onMount(() => {
    const iv = setInterval(() => setIdx((i) => (i + 1) % THINKING_VERBS.length), VERB_ROTATE_MS);
    onCleanup(() => clearInterval(iv));
  });
  return () => THINKING_VERBS[idx()]!;
}

function Dots(props: { size: string }) {
  return (
    <span class="inline-flex items-center gap-0.5">
      <span class={`${props.size} rounded-full bg-emerald-400 animate-pulse-soft`} />
      <span class={`${props.size} rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:200ms]`} />
      <span class={`${props.size} rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:400ms]`} />
    </span>
  );
}

/**
 * V89.2 — shown UNDER a streaming bubble that has partial text but has
 * received nothing for >1.5 s, so the operator never stares at frozen
 * text while the agent is mid tool-call. Disappears the instant another
 * delta lands (the store's last-delta stamp bumps).
 */
export function StreamingIdleHint(props: { conv: string }) {
  const [nowMs, setNowMs] = createSignal(Date.now());
  const verb = useRotatingVerb();
  onMount(() => {
    // Own 500 ms wall-clock so the threshold check stays reactive
    // without a global ticker.
    const tick = setInterval(() => setNowMs(Date.now()), 500);
    onCleanup(() => clearInterval(tick));
  });
  const idleMs = (): number => {
    const last = chatStore.state.lastDeltaTsByConv[props.conv];
    if (typeof last !== 'number') return 0;
    return nowMs() - last;
  };
  return (
    <Show when={idleMs() > IDLE_HINT_MS}>
      <div class="flex items-center gap-2 text-emerald-300/70 italic text-[12px] mt-1.5">
        <Dots size="w-1 h-1" />
        <span>{verb()}…</span>
      </div>
    </Show>
  );
}

/** V86s — the body of a streaming bubble that has no text yet. */
export function ThinkingPlaceholder() {
  const verb = useRotatingVerb();
  return (
    <div class="flex items-center gap-2 text-emerald-300/90 italic">
      <Dots size="w-1.5 h-1.5" />
      <span class="transition-opacity duration-300">{verb()}…</span>
    </div>
  );
}

/**
 * Live preview clipped to the last few lines: `column-reverse` plus
 * `overflow:hidden` keeps the BOTTOM of overflowing content visible.
 *
 * V105 — rendered as markdown live, same `.chat-md` styling as the final
 * view, so the streaming → final transition is visually invisible.
 * Unclosed tokens (mid-table, mid-fence) marked treats as plain text, so
 * flicker is minimal. V106.2 — a top mask fades the clip so a half-cut
 * line dissolves instead of being chopped.
 */
export function StreamingTail(props: { text: string }) {
  const [html, setHtml] = createSignal<string>('');
  createEffect(() => {
    const t = props.text;
    void ensureMarked().then((m) => {
      try {
        setHtml(colorizeInlineCodeInHtml(m.parse(t, { gfm: true })));
      } catch {
        // marked does not throw on valid input; if a mid-stream token
        // trips an edge case, fall back to the raw text.
        setHtml(t);
      }
    }).catch(() => setHtml(t));
  });
  const mask = 'linear-gradient(to bottom, transparent 0, rgba(0,0,0,0.4) 12px, #000 28px)';
  return (
    <div
      class="overflow-hidden flex flex-col-reverse"
      style={{
        'max-height': `${STREAM_TAIL_HEIGHT_PX}px`,
        '-webkit-mask-image': mask,
        'mask-image': mask,
      }}
    >
      <div class="chat-md" innerHTML={html() || props.text} />
    </div>
  );
}
