/**
 * StopButton — V107.20, the persistent STOP in the chat header.
 *
 * The inline ■ stop on a bubble only shows while a streaming assistant
 * bubble is on screen. But the agent stays live through tool calls, file
 * edits and subagent coordination — moments with no bubble where the
 * operator may well want to halt. This button reads the daemon's own
 * `live` / `coordinating` (via `isConvWorking`), so it mirrors ground
 * truth rather than the local streaming flag.
 */

import { createSignal } from 'solid-js';
import { chatStore } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { log } from '~/lib/log';

export default function StopButton(props: { conv: string }) {
  const [stopping, setStopping] = createSignal(false);
  const snap = () => chatStore.state.convs[props.conv] ?? null;
  const label = (): string => (snap()?.coordinating ? 'STOP all' : 'STOP');
  const title = (): string => {
    const c = snap();
    if (c?.coordinating) {
      return `Coordinating ${c.waiting_on?.length ?? 0} subagent(s) — cancels THIS agent's turn `
        + `(subagents continue unless they're on their own STOP)`;
    }
    return 'Stop this turn — sends SIGTERM to the agent process. Any tool call already in flight '
      + '(file write, bash) may finish before the kill lands.';
  };
  const onStop = async (): Promise<void> => {
    const client = daemonStore.state.client;
    if (!client) return;
    setStopping(true);
    try {
      const r = await client.chatCancel(props.conv);
      if (!r.ok) log.warn('[chat-scope-strip:stop] /chat/cancel failed', r.status);
    } finally {
      // Hold "stopping…" for ~1 s so the operator gets visible feedback
      // before the live signal flips off over WS.
      setTimeout(() => setStopping(false), 1000);
    }
  };
  return (
    <button
      type="button"
      onClick={() => { void onStop(); }}
      disabled={stopping()}
      title={title()}
      class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider text-red-200 bg-red-500/15 border border-red-500/50 hover:bg-red-500/25 hover:border-red-500/70 active:bg-red-500/35 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-wait"
    >
      <span class="inline-block w-1.5 h-1.5 rounded-sm bg-red-300" aria-hidden="true" />
      {stopping() ? 'stopping…' : label()}
    </button>
  );
}
