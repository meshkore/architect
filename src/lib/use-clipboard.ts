/**
 * use-clipboard.ts — "copy, then say `copied ✓` for a moment".
 *
 * AX11 (cockpit-excellence). Twelve call sites each hand-rolled the same
 * signal + `setTimeout`, and several leaked the timer when the component
 * unmounted mid-flight. The hook owns the timer and clears it on
 * cleanup, so a copy started right before a project switch cannot fire
 * a setter into a disposed owner.
 *
 * `copy(text, key?)` — the optional key lets ONE hook drive several
 * buttons (token / snippet / path): `copied() === 'token'`.
 */

import { createSignal, onCleanup } from 'solid-js';
import { log } from '~/lib/log';

const FEEDBACK_MS = 1500;

export interface Clipboard {
  /** The key of the last successful copy, or null. Reactive. */
  copied: () => string | null;
  /** True while any copy feedback is showing. Reactive. */
  isCopied: (key?: string) => boolean;
  /** Copy `text`; resolves false when the browser denied clipboard access. */
  copy: (text: string, key?: string) => Promise<boolean>;
}

export function useClipboard(feedbackMs = FEEDBACK_MS): Clipboard {
  const [copied, setCopied] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => { if (timer) clearTimeout(timer); });

  const copy = async (text: string, key = 'default'): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      log.warn('clipboard write failed', e instanceof Error ? e.message : String(e));
      return false;
    }
    setCopied(key);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setCopied((c) => (c === key ? null : c)), feedbackMs);
    return true;
  };

  return {
    copied,
    isCopied: (key = 'default') => copied() === key,
    copy,
  };
}
