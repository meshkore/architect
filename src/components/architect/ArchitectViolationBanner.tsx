/**
 * ArchitectViolationBanner — V107.3.
 *
 * Detects when the architect halted mid-pass with a question — the
 * exact failure mode the chain (catalog → stub-flag → matrix →
 * consult-A001) is supposed to make impossible. When the model
 * violates anyway, this banner gives the operator visible feedback
 * ("this is a bug, not a normal stop") + a one-click Reset that
 * cancels + archives the architect's conv so they can Run all
 * again fresh.
 *
 * Hooked from AssistantBubble: only renders when `isHaltViolation`
 * matches the message text AND the conv is a roadmap-architect-* one.
 */

import { createSignal, Show } from 'solid-js';
import { chatStore } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { log } from '~/lib/log';

export default function ArchitectViolationBanner(props: { conv: string }) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const onReset = async (): Promise<void> => {
    const client = daemonStore.state.client;
    if (!client) {
      setError('No daemon client');
      return;
    }
    setBusy(true);
    setError(null);
    log.info('[architect-reset] cancel + archive', { conv: props.conv });
    try {
      const cancel = await client.chatCancel(props.conv);
      log.info('[architect-reset] /chat/cancel', { ok: cancel.ok, status: cancel.status });
      const archive = await client.chatArchive(props.conv);
      log.info('[architect-reset] /chat/archive', { ok: archive.ok, status: archive.status });
      chatStore.archiveConv(props.conv);
      // Surface a non-architect conv so the operator isn't left on the archived one.
      const remaining = Object.keys(chatStore.state.convMeta).find(
        (c) => !chatStore.state.archivedConvs[c] && c !== props.conv,
      );
      if (remaining) chatStore.setActiveConv(remaining);
    } catch (e) {
      log.warn('[architect-reset] threw', e instanceof Error ? e.message : String(e));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 mb-2 flex items-center gap-3 max-w-[90%]">
      <span aria-hidden="true" class="text-red-300 text-base">⚠</span>
      <div class="flex-1 min-w-0">
        <p class="text-[12px] text-red-200 leading-snug">
          <strong class="font-semibold">Architect protocol violation.</strong>{' '}
          The agent halted mid-pass with a question — it should have used
          stub-and-flag or consulted A001. The message below is informational;
          you don't need to answer.
        </p>
      </div>
      <button
        type="button"
        onClick={() => { void onReset(); }}
        disabled={busy()}
        title="Cancel + archive this architect conv so Run All can spawn a fresh one."
        class="px-2.5 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider bg-red-500/20 hover:bg-red-500/35 text-red-200 border border-red-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
      >
        {busy() ? 'Resetting…' : 'Reset architect'}
      </button>
      <Show when={error()}>
        <span class="text-[10px] text-red-300 font-mono">{error()}</span>
      </Show>
    </div>
  );
}
