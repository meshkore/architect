import { Show, createMemo, createSignal, createEffect } from 'solid-js';
import { chatStore, type ChatMsg } from '~/state/chat';
import ChatScopeStrip from '~/components/ChatScopeStrip';
import ChatHistoryView from '~/components/ChatHistoryView';
import ChatComposer from '~/components/ChatComposer';
import RoleMemoryViewer from '~/components/RoleMemoryViewer';
import ChatThread from '~/components/chat/ChatThread';
import { AgentRoleHint, EmptyChat } from '~/components/chat/ChatExtras';
import { isServiceType } from '~/lib/agent-types';
import { daemonStore } from '~/state/daemon';
import { openTokenUnlockModal } from '~/components/modals/TokenUnlockModal';
// V97 — `openDaemonOutdatedModal` removed (no more floating modal).
// When the daemon is outdated, Cockpit replaces the entire main area
// with <DaemonOutdatedPanel>, so the ChatPanel never renders in that
// state. The `onDaemonOutdated` ChatComposer prop is dead code; left
// in place to keep the composer's contract stable for other callers.
import { buildStream, type StreamItem } from '~/lib/chat-stream';

// V83 — drop the `client` prop. Read the current DaemonClient
// reactively from daemonStore so chat actions follow project
// hot-swaps (daemonStore.switchToPort) without the parent having to
// re-pass a fresh client.
export default function ChatPanel() {
  const client = () => daemonStore.state.client;
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [memoryOpen, setMemoryOpen] = createSignal(false);
  let threadEl: HTMLDivElement | undefined;

  const conv = () => chatStore.state.activeConv;
  const meta = () => {
    const c = conv();
    return c ? chatStore.state.convMeta[c] : undefined;
  };
  const msgs = (): ChatMsg[] => {
    const c = conv();
    return c ? chatStore.state.convMap[c] ?? [] : [];
  };
  const stream = createMemo(() => {
    const c = conv();
    if (!c) return { pre: [] as StreamItem[], queued: [] as StreamItem[], live: null as ChatMsg | null };
    return buildStream(c, msgs());
  });
  const isRunning = () => stream().live !== null;

  createEffect(() => {
    void stream();
    queueMicrotask(() => {
      if (threadEl && !historyOpen()) threadEl.scrollTop = threadEl.scrollHeight;
    });
  });
  createEffect(() => { void conv(); setHistoryOpen(false); });

  const archive = () => {
    const c = conv();
    if (!c) return;
    chatStore.archiveConv(c);
    chatStore.setActiveConv(null);
  };

  const rename = (next: string) => {
    const c = conv();
    if (c) chatStore.setConvTitle(c, next);
  };

  const onTokenRejected = () => {
    const h = daemonStore.state.health;
    const cli = client();
    if (!h || !cli) return;
    openTokenUnlockModal({
      project: { port: h.port, cluster_id: h.cluster_id ?? null, cluster_name: h.cluster_name ?? null },
      reason: 'Token rejected by /chat/dispatch — paste a fresh one.',
      onUnlocked: (token) => { cli.transport.token = token; },
    });
  };

  return (
    <div class="flex flex-col h-full min-h-0 bg-gray-950/30 border border-gray-800/60 rounded-lg overflow-hidden">
      <Show when={conv()} fallback={<EmptyChat />}>
        <ChatScopeStrip
          conv={conv()!}
          meta={meta()}
          historyOpen={historyOpen()}
          onToggleHistory={() => setHistoryOpen((v) => !v)}
          onRename={rename}
          onArchive={archive}
          onOpenRoleMemory={() => setMemoryOpen(true)}
        />
        <Show when={meta()}>
          <RoleMemoryViewer
            isOpen={memoryOpen()}
            onClose={() => setMemoryOpen(false)}
            type={meta()!.type}
            rootPath={daemonStore.state.health?.identity ? null : null}
          />
        </Show>
        <Show when={!historyOpen()} fallback={
          <ChatHistoryView conv={conv()!} onClose={() => setHistoryOpen(false)} />
        }>
          <ChatThread ref={(el) => (threadEl = el)} stream={stream()} />
        </Show>
        {/* V89.2 — StopBar removed. The Stop control now lives inline
            in the streaming agent bubble's BubbleHeader, on the same
            row as the byline at the far right (subtle but
            unmistakable). One control per turn — the operator stops
            the speaker, not a generic bar attached to the composer. */}
        <ChatComposer
          conv={conv()!}
          placeholder={isRunning()
            ? 'Add more instructions — they go above the live work and get merged into the next turn…'
            : 'Reply…'}
          /* V97 — onDaemonOutdated prop is dead code; the outdated
              state is now caught by Cockpit before ChatPanel renders */
          onTokenRejected={onTokenRejected}
        />
        <Show when={isServiceType(meta()?.type) && msgs().length === 0}>
          <AgentRoleHint type={meta()!.type} />
        </Show>
      </Show>
    </div>
  );
}
