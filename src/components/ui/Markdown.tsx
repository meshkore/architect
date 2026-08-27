/**
 * Markdown — render a markdown string, degrade to plain text.
 *
 * AX11 (cockpit-excellence). `marked` is CDN-loaded on first use, so
 * "the renderer never arrived" is a state every caller has to handle.
 * This component makes the fallback non-optional: when rendering fails
 * the raw text still reaches the operator as a <pre>, it never silently
 * renders nothing.
 *
 * `innerHTML` is safe here in the cockpit's threat model: the source is
 * the operator's own `.meshkore/` files and their own agents' output,
 * both already trusted enough to execute shell commands on this machine.
 */

import { Show } from 'solid-js';
import { useMarkdown } from '~/lib/use-markdown';

const DEFAULT_PROSE = 'md prose prose-invert max-w-none text-[13px] leading-relaxed';
const DEFAULT_FALLBACK = 'whitespace-pre-wrap text-[12px] text-gray-400 font-mono leading-relaxed';

export function Markdown(props: {
  text: string;
  /** Overrides the prose classes on the rendered container. */
  class?: string;
  /** Overrides the classes on the raw-text <pre> fallback. */
  fallbackClass?: string;
}) {
  const html = useMarkdown(() => props.text);
  return (
    <Show
      when={html()}
      fallback={<pre class={props.fallbackClass ?? DEFAULT_FALLBACK}>{props.text}</pre>}
    >
      <div class={props.class ?? DEFAULT_PROSE} innerHTML={html() ?? ''} />
    </Show>
  );
}

export default Markdown;
