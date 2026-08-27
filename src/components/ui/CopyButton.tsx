/**
 * CopyButton — copy some text, confirm it inline.
 *
 * AX11 (cockpit-excellence). `text` is a THUNK, not a string: several
 * call sites copy a value that must not be materialised until the
 * click (a revealed bearer token, a snippet built from live state).
 */

import { Show } from 'solid-js';
import { useClipboard } from '~/lib/use-clipboard';

export function CopyButton(props: {
  /** Evaluated on click — keeps secrets out of the render path. */
  text: () => string;
  /** Idle label. Defaults to "copy". */
  label?: string;
  /** Confirmation label. Defaults to "copied ✓". */
  copiedLabel?: string;
  title?: string;
  class?: string;
  onFailed?: () => void;
}) {
  const clip = useClipboard();
  const onClick = (): void => {
    void clip.copy(props.text()).then((ok) => { if (!ok) props.onFailed?.(); });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={props.title ?? 'Copy to clipboard'}
      class={
        props.class ??
        'text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1 transition-colors'
      }
    >
      <Show when={clip.isCopied()} fallback={props.label ?? 'copy'}>
        {props.copiedLabel ?? 'copied ✓'}
      </Show>
    </button>
  );
}

export default CopyButton;
