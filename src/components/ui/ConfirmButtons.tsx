/**
 * ConfirmButtons — inline two-step confirmation.
 *
 * AX11 (cockpit-excellence). Four confirm mechanisms coexisted; three
 * of them were the browser's native blocking `confirm()`, which freezes
 * the whole cockpit — including the WS pump — until the operator
 * answers. A dialog nobody dismissed could therefore stall live chat
 * ingestion, so no destructive action in this codebase may use it.
 *
 * The control renders as its trigger until armed, then swaps in place
 * for `question · Yes · No`. Arming is auto-disarmed after
 * `timeoutMs` so a forgotten armed button cannot be hit by a later,
 * unrelated click.
 */

import { Show, createSignal, onCleanup, type JSX } from 'solid-js';

const DISARM_MS = 6000;

export function ConfirmButtons(props: {
  /** Prompt shown while armed, e.g. "Clear the queue?". */
  question: string;
  onConfirm: () => void;
  /** The idle trigger — a button, a pill, whatever the host uses. */
  trigger: (arm: () => void) => JSX.Element;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Classes for the Yes / No buttons; defaults suit dense toolbars. */
  confirmClass?: string;
  cancelClass?: string;
  questionClass?: string;
  timeoutMs?: number;
}) {
  const [armed, setArmed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const disarm = (): void => {
    setArmed(false);
    if (timer) { clearTimeout(timer); timer = undefined; }
  };
  const arm = (): void => {
    setArmed(true);
    if (timer) clearTimeout(timer);
    timer = setTimeout(disarm, props.timeoutMs ?? DISARM_MS);
  };
  onCleanup(() => { if (timer) clearTimeout(timer); });

  return (
    <Show when={armed()} fallback={props.trigger(arm)}>
      <span class="inline-flex items-center gap-1.5">
        <span class={props.questionClass ?? 'text-[11px] font-mono text-gray-400'}>{props.question}</span>
        <button
          type="button"
          onClick={() => { disarm(); props.onConfirm(); }}
          class={
            props.confirmClass ??
            'text-[11px] font-mono uppercase tracking-wider text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 rounded px-2 py-0.5 transition-colors'
          }
        >
          {props.confirmLabel ?? 'Yes'}
        </button>
        <button
          type="button"
          onClick={disarm}
          class={
            props.cancelClass ??
            'text-[11px] font-mono uppercase tracking-wider text-gray-400 hover:text-gray-100 border border-gray-700/50 rounded px-2 py-0.5 transition-colors'
          }
        >
          {props.cancelLabel ?? 'No'}
        </button>
      </span>
    </Show>
  );
}

export default ConfirmButtons;
