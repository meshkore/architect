import { Show, createMemo, createSignal, createEffect } from 'solid-js';
import { chatStore, ONBOARDING_CONV_ID, type ChatMsg } from '~/state/chat';
import { log } from '~/lib/log';
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
import RunnerAuthCard from '~/components/RunnerAuthCard';

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

  // CSR5 (2026-06-11) — conv switch is a hard reset: snap to bottom,
  // no querySelector dance, no scrollIntoView. The leak that caused
  // "sube, baja, append al cambiar de agente" was a module-closure
  // `lastLiveStreamId` shared across convs.
  //
  // 2026-06-12 — operator field report: "cuando empieza a escribir
  // la gente, lo hace por debajo, no estamos gestionando la zona
  // visible". The CSR5 effect only scrolled on conv-switch and on
  // the FIRST appearance of a new stream — once `lastLiveStreamId`
  // matched, every subsequent delta was a no-op. The assistant
  // bubble grew past the viewport while the scroll position stayed
  // pinned. Fix: track "sticky-bottom" via a scroll listener, and on
  // every msgs/stream tick, if the operator was at the bottom before
  // the mutation, snap to bottom AFTER. If they scrolled up to read
  // earlier content, leave them alone.
  let lastLiveStreamId: string | null = null;
  let lastConv: string | null = null;
  let stickyBottom = true;
  const SCROLL_BOTTOM_SLACK_PX = 32;
  const updateSticky = (): void => {
    if (!threadEl) return;
    const dist = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight;
    stickyBottom = dist <= SCROLL_BOTTOM_SLACK_PX;
  };
  const attachScrollListener = (el: HTMLDivElement | undefined): void => {
    if (!el) return;
    el.addEventListener('scroll', updateSticky, { passive: true });
  };
  createEffect(() => {
    const c = conv();
    const s = stream();
    const liveId = s.live?.stream_id ?? s.live?.ts ?? null;
    // Read msgs length too so the effect fires on every delta (text
    // grows on the streaming bubble without changing the array's
    // reference but Solid's store granularity catches the mutation).
    void s.live?.text;
    queueMicrotask(() => {
      if (!threadEl || historyOpen()) return;
      if (c !== lastConv) {
        lastConv = c;
        lastLiveStreamId = liveId;
        threadEl.scrollTop = threadEl.scrollHeight;
        stickyBottom = true;
        return;
      }
      const newLive = liveId && liveId !== lastLiveStreamId;
      lastLiveStreamId = liveId;
      if (newLive) {
        const target = threadEl.querySelector<HTMLElement>('[data-live-bubble="1"]');
        if (target && target.getBoundingClientRect().height > threadEl.clientHeight) {
          target.scrollIntoView({ block: 'start', behavior: 'auto' });
          stickyBottom = false;
          return;
        }
        // Short reply / first delta — snap and arm sticky.
        threadEl.scrollTop = threadEl.scrollHeight;
        stickyBottom = true;
        return;
      }
      // Delta path: keep the live bubble visible as long as the
      // operator hasn't scrolled away.
      if (stickyBottom) {
        threadEl.scrollTop = threadEl.scrollHeight;
      }
    });
  });
  createEffect(() => { void conv(); setHistoryOpen(false); });

  const archive = async (): Promise<void> => {
    const c = conv();
    if (!c) {
      log.warn('[archive] no active conv — ignored');
      return;
    }
    // V107.12 — Architect Agent (onboarding conv) is never archivable.
    // The button is hidden in ChatScopeStrip but this guards against
    // any future call path (keyboard shortcut, programmatic invoke,
    // misconfiguration). Daemon-side guard in chatStore.archiveConv
    // is the canonical local enforcement; this prevents the daemon
    // round-trip from happening at all.
    if (c === ONBOARDING_CONV_ID) {
      log.warn('[archive] refused: Architect Agent (onboarding conv) is hardcoded as never-archivable', { conv: c });
      return;
    }
    // V107.9 — promoted to log.warn so the operator sees the trace
    // in production even without verbose mode. Archive is a
    // non-destructive action but if it ever fails silently in the
    // future the warn is the only crumb.
    log.warn('[archive] start', { conv: c });
    // Optimistic local update so the rail filter takes effect
    // instantly without waiting for the WS broadcast round-trip.
    chatStore.archiveConv(c);
    log.warn('[archive] local archiveConv done', { conv: c, archivedNow: chatStore.state.archivedConvs[c] === true });
    chatStore.setActiveConv(null);
    // V104 — sync to the daemon so the archive persists across
    // reload AND propagates to every other open tab via the
    // `chat.archived` WS broadcast. Before V104 the local button
    // only updated the per-tab signal, so hard refresh + V102
    // hydrate re-populated the rail with the un-synced convs.
    const cli = client();
    if (!cli) {
      log.warn('[archive] no daemon client — local-only archive (will not persist past reload)');
      return;
    }
    const res = await cli.chatArchive(c);
    log.warn('[archive] /chat/archive', { ok: res.ok, status: res.status });
    if (!res.ok) log.warn('[archive] sync to daemon failed', res.status);
  };

  const rename = (next: string) => {
    const c = conv();
    if (c) chatStore.setConvTitle(c, next);
  };

  const onTokenRejected = () => {
    const h = daemonStore.state.health;
    if (!h) return;
    openTokenUnlockModal({
      project: { port: h.port, cluster_id: h.cluster_id ?? null, cluster_name: h.cluster_name ?? null },
      reason: 'Token rejected by /chat/dispatch — paste a fresh one.',
      // A-TOKEN-01 (V110) — re-attach through switchToPortDetailed (the
      // modal already saved the new token to the per-cluster store). That
      // re-runs the D-TLS-02 identity challenge AND re-dials the WS
      // carrying the new token — vs the old `cli.transport.token = token`
      // which left the open WS streaming on the STALE credential.
      onUnlocked: () => { void daemonStore.switchToPortDetailed(h.port); },
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
          <ChatThread ref={(el) => { threadEl = el; attachScrollListener(el); }} stream={stream()} />
        </Show>
        {/* V89.2 — StopBar removed. The Stop control now lives inline
            in the streaming agent bubble's BubbleHeader, on the same
            row as the byline at the far right (subtle but
            unmistakable). One control per turn — the operator stops
            the speaker, not a generic bar attached to the composer. */}
        {/* py-1.12.5 — Runner auth card. Shown when daemon emits
            `runner.auth.required` (cursor-agent / claude-code need login).
            Dismissed automatically on `runner.auth.completed`. */}
        <Show when={daemonStore.state.runnerAuth && daemonStore.state.runnerAuth!.conv === conv()}>
          <div class="px-3 pb-1">
            <RunnerAuthCard
              platform={daemonStore.state.runnerAuth!.platform}
              conv={daemonStore.state.runnerAuth!.conv}
              onDismiss={() => daemonStore.setRunnerAuth(null)}
            />
          </div>
        </Show>
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
