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
import { chatStore, ONBOARDING_CONV_ID, type ChatMsg } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { ensureMarked } from '~/lib/cdn-loaders';
import { log } from '~/lib/log';
import type { DaemonEvent } from '~/lib/daemon-client';
import ValidationBlock, { isValidationRed, isValidationGreen, isHaltViolation } from '~/components/architect/ValidationBlock';
import ValidationGreenBadge, { stripGreenMarker } from '~/components/architect/ValidationGreenBadge';
import ArchitectViolationBanner from '~/components/architect/ArchitectViolationBanner';

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
function CollapsibleText(props: {
  text: string;
  lockExpanded?: boolean;
  markdown?: boolean;
  /** V89.2 — When true, the bubble starts EXPANDED. Used by the
   *  assistant bubble for fresh-final summaries (auto-expand once the
   *  agent just finished its turn). After the operator toggles, the
   *  internal `expanded` signal owns the state — the prop only
   *  influences the initial value. */
  initialExpanded?: boolean;
  children?: JSX.Element;
}) {
  const [expanded, setExpanded] = createSignal(!!props.initialExpanded);
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
        {/* V101 — Chat-bubble markdown: `chat-md` is the bubble-scoped
            stylesheet (cockpit.css) with capped heading sizes (h1
            1.2× body, never larger), scrollable code blocks (fixes
            the "tiny vertical column of one letter" bug), scrollable
            tables on overflow, and the emerald palette. Dropped the
            Tailwind Typography classes (`prose prose-invert prose-sm
            max-w-none`) for chat — they were fighting our explicit
            rules with higher specificity. ContextPanel / DiaryPanel /
            ProtocolsPanel keep their wider `.md prose` styling
            because they have more horizontal room. */}
        <div
          ref={(el) => { bodyEl = el; }}
          class="chat-md overflow-hidden transition-[max-height] duration-150"
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
  /** V89.2 — When present, renders a subtle Stop control at the far
   *  end of the header line (after the fade). Used by streaming
   *  AssistantBubble + PreparingBubble so the operator can interrupt
   *  the turn from the same row as the byline, no extra bar above
   *  the composer. */
  onStop?: () => void;
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
  // UI strings are English-only. Legacy "architect"/"operator"/"user"
  // author tags are normalised to "USER"; any custom author string the
  // daemon supplies is rendered verbatim.
  const label = (): string => {
    const a = props.msg.author?.trim();
    if (a && a !== 'architect' && a !== 'operator' && a !== 'user') return a;
    return 'USER';
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
        props.prepend ? 'text-amber-200/95' : 'text-gray-200'
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
  // V89.1 — Author label fallback chain. The daemon emits assistant
  // events with author=self.identity (the host machine), which is
  // wrong UX; the assistant IS the agent, not the daemon host. So we
  // prefer the cockpit's convMeta.title, then the agentId chip, then
  // the daemon author, then a neutral 'agent'. Critically, the old
  // 'coordinator' fallback is GONE outside the onboarding conv — it
  // was leaking into every untitled custom conv.
  const isOnboarding = () => chatStore.state.activeConv === ONBOARDING_CONV_ID;
  const agentName = () => {
    const title = meta()?.title?.trim();
    if (title) return title;
    if (isOnboarding()) return 'coordinator';
    const aid = agentId();
    if (aid) return aid;
    const author = props.msg.author?.trim();
    if (author && author !== 'architect' && author !== 'operator' && author !== 'user') return author;
    return 'agent';
  };
  // V89.2 — Inline Stop control on the streaming agent bubble.
  // Replaces the standalone StopBar above the composer; lives on the
  // same row as the byline, at the far right after the fade.
  const onStop = (): void => {
    const conv = chatStore.state.activeConv;
    const client = daemonStore.state.client;
    if (!conv || !client) return;
    void client.chatCancel(conv);
  };
  // V107 — Detect VALIDATION RED block emitted by the architect's
  // first turn (daemon py-1.10.9+) and render a special interactive
  // block with a textarea + submit, instead of the normal markdown.
  const showsValidationRed = (): boolean =>
    !props.msg.streaming && !props.msg.cancelled && isValidationRed(props.msg.text);

  // V107.3 — Detect VALIDATION GREEN at the top of an assistant
  // message → render a small badge + strip the marker line from the
  // body so the markdown render below starts at the pre-flight block.
  const showsValidationGreen = (): boolean =>
    !props.msg.streaming && !props.msg.cancelled && isValidationGreen(props.msg.text);

  // V107.3 — Detect halt-violation patterns on architect convs.
  // Renders a red banner above the bubble with a one-click Reset
  // button so the operator knows it's a bug, not a normal stop.
  const isArchitectConv = (): boolean => {
    const conv = chatStore.state.activeConv;
    if (!conv) return false;
    if (conv.startsWith('roadmap-architect-')) return true;
    return chatStore.state.convMeta[conv]?.type === 'roadmap-architect';
  };
  const showsHaltViolation = (): boolean =>
    !props.msg.streaming
    && !props.msg.cancelled
    && isArchitectConv()
    && isHaltViolation(props.msg.text);

  // Body text — strip the GREEN marker line so the markdown render
  // below doesn't show the literal `═══ ... ═══` line.
  const bodyText = (): string =>
    showsValidationGreen() ? stripGreenMarker(props.msg.text) : props.msg.text;

  return (
    <div class="flex flex-col gap-1.5 items-start w-full">
      <BubbleHeader
        primary={agentName()}
        id={agentId() ?? undefined}
        ts={props.msg.ts}
        align="left"
        tone={props.msg.cancelled ? 'cancelled' : 'agent'}
        suffix={props.msg.cancelled ? 'cancelled' : undefined}
        onStop={props.msg.streaming && !props.msg.cancelled ? onStop : undefined}
      />
      <Show when={showsValidationRed()} fallback={
      <>
        <Show when={showsHaltViolation()}>
          <ArchitectViolationBanner conv={chatStore.state.activeConv ?? ''} />
        </Show>
        <Show when={showsValidationGreen()}>
          <ValidationGreenBadge />
        </Show>
        <div class={`text-sm leading-relaxed max-w-[90%] pl-2 ${
          props.msg.cancelled ? 'text-red-300/95' : 'text-gray-200'
        }`}>
          <Show
            when={props.msg.streaming}
            fallback={
              <CollapsibleText text={bodyText()} markdown initialExpanded={props.msg._freshFinal}>
                <Show when={props.msg.cancelled}>
                  <span class="text-red-400/80 text-[11px]"> · cancelled</span>
                </Show>
              </CollapsibleText>
            }
          >
            {/* V86s — Empty-streaming → ThinkingPlaceholder; populated
                streaming → tail clamp showing the latest 3 lines. */}
            <Show when={props.msg.text.trim().length > 0} fallback={<ThinkingPlaceholder />}>
              <StreamingTail text={props.msg.text} />
            </Show>
            {/* V89.2 — While streaming AND nothing new has arrived for
                >1.5 s, append the rotating-verbs idle hint so the
                operator gets visible motion even if the agent is mid
                tool-call or pausing to think. Disappears the moment a
                new delta lands. */}
            <Show when={props.msg.streaming && props.msg.text.trim().length > 0}>
              <StreamingIdleHint />
            </Show>
          </Show>
        </div>
      </>
      }>
        <ValidationBlock conv={chatStore.state.activeConv ?? ''} text={props.msg.text} />
      </Show>
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
/**
 * V105 — Wider pool of placeholder verbs. The 6 originals
 * ("Thinking · Working · Researching · Planning · Generating ·
 * Processing") rotated every 1.8 s so a 30-second pause cycled
 * them all three times. The operator: "seamos más originales o
 * tengamos 30 mensajes diferentes para que se vea que estamos
 * haciendo cosas". 36 entries now → a full lap takes ~65 s, and
 * the mix spans cognitive verbs, work verbs, mesh-aware verbs,
 * and a few quietly playful ones so a long pause looks like
 * actual progress instead of a 3-state loader. */
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

/**
 * V89.2 — Inline idle hint shown UNDER a streaming bubble that has
 * partial text but hasn't received a new chunk for >1.5 s. Keeps the
 * activity signal alive when the agent is mid tool-call or pausing
 * mid-thought, so the operator never stares at frozen text. The hint
 * disappears the instant another delta lands (lastDeltaTsByConv
 * bumps and idleMs drops below the threshold).
 *
 * Reads the active conv's last-delta timestamp from chatStore; ticks
 * its own 500 ms wall-clock so the threshold check stays reactive
 * without a global ticker.
 */
const IDLE_HINT_MS = 1500;
function StreamingIdleHint() {
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [idx, setIdx] = createSignal(0);
  onMount(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 500);
    const rotate = setInterval(() => setIdx((i) => (i + 1) % THINKING_VERBS.length), 1800);
    onCleanup(() => { clearInterval(tick); clearInterval(rotate); });
  });
  const idleMs = (): number => {
    const conv = chatStore.state.activeConv;
    if (!conv) return 0;
    const last = chatStore.state.lastDeltaTsByConv[conv];
    if (typeof last !== 'number') return 0;
    return nowMs() - last;
  };
  return (
    <Show when={idleMs() > IDLE_HINT_MS}>
      <div class="flex items-center gap-2 text-emerald-300/70 italic text-[12px] mt-1.5">
        <span class="inline-flex items-center gap-0.5">
          <span class="w-1 h-1 rounded-full bg-emerald-400/80 animate-pulse-soft" />
          <span class="w-1 h-1 rounded-full bg-emerald-400/80 animate-pulse-soft [animation-delay:200ms]" />
          <span class="w-1 h-1 rounded-full bg-emerald-400/80 animate-pulse-soft [animation-delay:400ms]" />
        </span>
        <span>{THINKING_VERBS[idx()]}…</span>
      </div>
    </Show>
  );
}

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
 * overflowing content visible.
 *
 * V105 — Render the streaming text as markdown live instead of raw
 * plain text. Operator: "cuando la gente ya ha empezado a generar
 * un output, hay un problema de display, no estamos imprimiendo
 * bien con los márgenes correctos o respetando los formatos."
 * Symptoms: bold markers (`**foo**`), inline code (`` `bar` ``),
 * and list bullets appeared verbatim during streaming — only the
 * post-final view (CollapsibleText with markdown=true) parsed
 * them. Now both branches go through `marked.parse`, so bold,
 * italics, inline code, and incomplete list/table tokens render
 * elegantly mid-stream. Tokens that haven't closed yet (mid-table,
 * mid-pre) marked handles gracefully by treating the partial line
 * as plain — visual flicker is minimal.
 *
 * Same .chat-md scoped styling as the final view so the
 * transition from streaming → final is visually invisible
 * (just text gains a few more characters).
 */
function StreamingTail(props: { text: string }) {
  const [html, setHtml] = createSignal<string>('');
  createEffect(() => {
    const t = props.text;
    void ensureMarked().then((m) => {
      try {
        setHtml(m.parse(t, { gfm: true }));
      } catch {
        // marked never throws on valid input, but if mid-stream
        // tokens trip an edge case, fall back to escaped raw.
        setHtml(t);
      }
    }).catch(() => setHtml(t));
  });
  // V106.2 — Top mask gradient. The tail clips at `max-height` with
  // `flex-col-reverse` (anchor bottom). When the clip cuts mid-line
  // (e.g. half a list marker "2." visible), it looks broken. The
  // `mask-image` fades the top ~20px so any partial line dissolves
  // naturally instead of being chopped in half.
  return (
    <div
      class="overflow-hidden flex flex-col-reverse"
      style={{
        'max-height': `${STREAM_TAIL_HEIGHT_PX}px`,
        '-webkit-mask-image':
          'linear-gradient(to bottom, transparent 0, rgba(0,0,0,0.4) 12px, #000 28px)',
        'mask-image':
          'linear-gradient(to bottom, transparent 0, rgba(0,0,0,0.4) 12px, #000 28px)',
      }}
    >
      <div class="chat-md" innerHTML={html() || props.text} />
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
  // V89.1 — Same fallback rules as AssistantBubble: 'coordinator'
  // ONLY for the onboarding conv. Untitled custom convs fall back
  // to the agentId chip, never to 'coordinator' (which was leaking
  // a totally unrelated agent name into the bubble).
  const isOnboarding = () => chatStore.state.activeConv === ONBOARDING_CONV_ID;
  const primary = () => {
    const title = meta()?.title?.trim();
    if (title) return title;
    if (isOnboarding()) return 'coordinator';
    const aid = meta()?.agentId;
    return aid || 'agent';
  };
  // V89.2 — Same inline Stop control as the streaming agent bubble.
  const onStop = (): void => {
    const conv = chatStore.state.activeConv;
    const client = daemonStore.state.client;
    if (!conv || !client) return;
    void client.chatCancel(conv);
  };
  return (
    <div class="flex flex-col gap-1.5 items-start w-full">
      <BubbleHeader
        primary={primary()}
        id={meta()?.agentId ?? undefined}
        ts={undefined}
        align="left"
        tone="agent"
        onStop={onStop}
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
