/**
 * CollapsibleText — clamp-plus-markdown text block.
 *
 * Renders `text` up to `collapsedMaxPx` tall; when it overflows, a
 * "+ show more" toggle appears below and the cut is softened with a mask
 * gradient so a partial line reads as trimmed, not chopped. With
 * `markdown`, the text is parsed by marked and rendered into the
 * `chat-md` scoped stylesheet.
 *
 * AX13 (cockpit-excellence) moved it out of `ChatBubbles`: it is generic
 * (the roadmap's task summaries use it too, which is why roadmap code
 * used to import from the chat file) and belongs in `ui/`.
 *
 * `lockExpanded` (assistant streaming in flight) skips collapsing
 * entirely — operators want to watch text grow, not see it clipped.
 */

import { Show, createEffect, createSignal, onMount, type JSX } from 'solid-js';
import { ensureMarked } from '~/lib/cdn-loaders';
import { colorizeInlineCodeInHtml } from '~/lib/code-colorize';
import { enhanceCodeBlocks } from '~/lib/enhance-code-blocks';
import { log } from '~/lib/log';

/**
 * V107.35 — collapse threshold in px, ~8 lines at body line-height. The
 * original 96px teased 4 lines, which was not enough context to decide
 * whether to expand.
 */
const COLLAPSED_MAX_PX = 144;
const COLLAPSED_MASK =
  'linear-gradient(to bottom, #000 0%, #000 70%, rgba(0,0,0,0.55) 88%, transparent 100%)';

export function CollapsibleText(props: {
  text: string;
  lockExpanded?: boolean;
  markdown?: boolean;
  /** Collapsed-height cap in px. Defaults to the chat-bubble value; the
   *  roadmap's RES/DES summary passes a small one so a finished task
   *  shows a two-line teaser per row. */
  collapsedMaxPx?: number;
  children?: JSX.Element;
}) {
  const cap = (): number => props.collapsedMaxPx ?? COLLAPSED_MAX_PX;
  // V107.36 — always start collapsed. The old auto-expand-on-fresh-final
  // un-clamped every reply, so a 50-line wall landed in the operator's
  // face — the exact complaint behind the daemon's Output Contract.
  const [expanded, setExpanded] = createSignal(false);
  const [overflows, setOverflows] = createSignal(false);
  const [html, setHtml] = createSignal<string | null>(null);

  createEffect(() => {
    const t = props.text;
    if (!props.markdown) { setHtml(null); return; }
    // ensureMarked is CDN-loaded; cached after the first call.
    void ensureMarked().then((m) => {
      try {
        setHtml(colorizeInlineCodeInHtml(m.parse(t, { gfm: true })));
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
    // Lift the inline cap briefly to read the true scrollHeight, then
    // restore it — otherwise the CSS max-height hides the overflow we
    // are trying to detect.
    const prevMax = bodyEl.style.maxHeight;
    bodyEl.style.maxHeight = 'none';
    const full = bodyEl.scrollHeight;
    bodyEl.style.maxHeight = prevMax;
    setOverflows(full > cap() + 2);
  };

  onMount(measure);
  // Re-measure on every text mutation — covers streaming, edits, and the
  // marked render lifecycle (the parsed HTML lands async).
  createEffect(() => { void props.text; void html(); queueMicrotask(measure); });
  createEffect(() => {
    void html();
    if (!props.markdown) return;
    queueMicrotask(() => { if (bodyEl) enhanceCodeBlocks(bodyEl); });
  });

  /**
   * V107.36 — when the agent self-discloses via native `<details>`
   * (the Output Contract: ≤8-line summary + one <details> per topic),
   * the message-level clamp is counter-productive: it would hide the
   * <details> headlines behind a second "show more". The clamp stays as
   * the safety net for agents that still emit a wall of plain prose.
   */
  const selfDiscloses = (): boolean => (html() ?? '').includes('<details');
  const collapsedNow = (): boolean =>
    !props.lockExpanded && !expanded() && overflows() && !selfDiscloses();
  const showToggle = (): boolean => !props.lockExpanded && overflows() && !selfDiscloses();

  const collapsedStyle = (): Record<string, string> => collapsedNow()
    ? {
        'max-height': `${cap()}px`,
        '-webkit-mask-image': COLLAPSED_MASK,
        'mask-image': COLLAPSED_MASK,
      }
    : { 'max-height': 'none' };

  return (
    <>
      <Show
        when={props.markdown && html() !== null}
        fallback={
          <div
            ref={(el) => { if (!props.markdown) bodyEl = el; }}
            class="whitespace-pre-wrap overflow-hidden transition-[max-height] duration-150"
            style={collapsedStyle()}
          >
            {props.text}
            {props.children}
          </div>
        }
      >
        {/* `chat-md` (cockpit.css) is the bubble-scoped stylesheet: capped
            heading sizes, scrollable code blocks and tables, the emerald
            palette. Tailwind Typography is deliberately NOT used here —
            its specificity fought our explicit rules. */}
        <div
          ref={(el) => { bodyEl = el; }}
          class="chat-md overflow-hidden transition-[max-height] duration-150"
          style={collapsedStyle()}
          innerHTML={html() ?? ''}
        />
        {props.children}
      </Show>
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

export default CollapsibleText;
