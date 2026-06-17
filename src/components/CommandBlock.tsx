/**
 * CommandBlock — a copy-paste-able code block with a clipboard button.
 *
 * Extracted from OfflinePanel (A-STARTCMD-HELPER-01, 2026-06-16) so the
 * global NoDaemon screen and the per-project OfflinePanel render the
 * same widget. Behaviour is verbatim from OfflinePanel's prior private
 * copy: optimistic "copied" flash, and a "select + ⌘C" fallback when the
 * Clipboard API is denied (insecure origin / no user gesture).
 */

import { Show, createSignal, type JSX } from 'solid-js';

export default function CommandBlock(props: {
  children: string;
  multiline?: boolean;
  label?: string;
}): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const [copyErr, setCopyErr] = createSignal(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Surface the failure instead of swallowing it; clipboard is often
      // denied without a user gesture / on insecure origins, and a silent
      // no-op looks like a dead button.
      setCopyErr(true);
      setTimeout(() => setCopyErr(false), 2500);
    }
  };
  return (
    <div class="rounded-lg border border-gray-800 bg-gray-950 p-3 font-mono text-[11px] text-gray-200 overflow-x-auto">
      <Show when={props.label}>
        <p class="text-[10px] uppercase tracking-wider text-gray-500 mb-2 font-mono">{props.label}</p>
      </Show>
      <div class="flex items-start justify-between gap-2">
        <code class={`whitespace-pre-wrap break-all leading-snug select-all ${props.multiline ? '' : ''}`}>{props.children}</code>
        <button
          type="button"
          onClick={() => { void copy(); }}
          class="flex-shrink-0 text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-gray-700 hover:border-gray-600 text-gray-400 hover:text-gray-200 transition-colors"
        >
          {copyErr() ? 'select + ⌘C' : copied() ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  );
}
