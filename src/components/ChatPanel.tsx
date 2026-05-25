/**
 * ChatPanel — central chat column (V80 monolith parity).
 *
 * Now reads from `chatStore`: activeConv + convMap[active] + convMeta.
 * The conversation list lives in ChatRail (M5.1); this panel only
 * cares about a single active conversation.
 *
 * Layout:
 *   - ScopeStrip    : title · edit · history · archive
 *   - Thread XOR History : the ≡ button swaps the body
 *   - Composer      : textarea + Send + Stop (Stop only while running)
 *
 * Bubble stream model:
 *   chat.user                → UserBubble (per event, dedup by ts+text)
 *   chat.assistant.final     → AssistantBubble (replaces the live delta
 *                              bubble for that stream_id, handled in
 *                              chatStore.ingestEvent)
 *   chat.assistant.delta     → live AssistantBubble (streaming flag on)
 *   chat.cancelled           → live bubble flips to cancelled
 *   tool.use / tool.result   → ToolUseBubble       (folded by ts)
 *   task.created/transition/cancelled → TaskLifecycleBubble (folded)
 *
 * Visual ordering rule (operator request 2026-05-18):
 *   While a coordinator turn is live, any chat.user events the operator
 *   sends *during* that turn render ABOVE the live bubble — not below
 *   in chronological order. The bottom-most bubble is always the live
 *   work, matching the daemon: those queued prompts are absorbed into
 *   the next chained turn.
 */

import { For, Show, createMemo, createSignal, createEffect } from 'solid-js';
import { chatStore, type ChatMsg } from '~/state/chat';
import { store } from '~/state/store';
import type { DaemonClient, DaemonEvent } from '~/lib/daemon-client';
import { log } from '~/lib/log';
import ChatScopeStrip from '~/components/ChatScopeStrip';
import ChatHistoryView from '~/components/ChatHistoryView';
import ChatComposer from '~/components/ChatComposer';
import {
  MessageBubble, ToolUseBubble, TaskLifecycleBubble,
} from '~/components/ChatBubbles';
import { agentTypeInfo, isServiceType } from '~/lib/agent-types';
import { daemonStore } from '~/state/daemon';
import { openTokenUnlockModal } from '~/components/modals/TokenUnlockModal';
import { openDaemonOutdatedModal } from '~/components/modals/DaemonOutdatedModal';

type StreamItem =
  | { kind: 'msg'; ts: string; msg: ChatMsg; prepend?: boolean }
  | { kind: 'tool'; ts: string; ev: DaemonEvent }
  | { kind: 'task'; ts: string; ev: DaemonEvent };

function buildStream(conv: string, msgs: ChatMsg[]): {
  pre: StreamItem[]; queued: StreamItem[]; live: ChatMsg | null;
} {
  // Locate the live bubble (assistant, streaming, last in list).
  const liveIdx = msgs.findIndex((m) => m.kind === 'assistant' && m.streaming);
  const live: ChatMsg | null = liveIdx >= 0 ? msgs[liveIdx]! : null;
  const liveTs = live?.ts ?? null;

  // Sidecar tool/task events for this conv from the live ring.
  const events: DaemonEvent[] = (store.events() as DaemonEvent[])
    .filter((e) => String(e['conv'] ?? '') === conv);

  const pre: StreamItem[] = [];
  const queued: StreamItem[] = [];

  msgs.forEach((m, i) => {
    if (i === liveIdx) return;
    const ts = m.ts ?? '';
    const item: StreamItem = { kind: 'msg', ts, msg: m };
    if (live && m.kind === 'user' && liveTs && ts > liveTs) {
      queued.push({ ...item, prepend: true });
    } else {
      pre.push(item);
    }
  });

  for (const e of events) {
    const t = String(e.type);
    const ts = String(e['ts'] ?? '');
    if (t === 'tool.use' || t === 'tool.result') {
      pre.push({ kind: 'tool', ts, ev: e });
    } else if (t.startsWith('task.')) {
      pre.push({ kind: 'task', ts, ev: e });
    }
  }
  pre.sort((a, b) => a.ts.localeCompare(b.ts));
  return { pre, queued, live };
}

export default function ChatPanel(props: { client: DaemonClient }) {
  const [cancelling, setCancelling] = createSignal(false);
  const [historyOpen, setHistoryOpen] = createSignal(false);
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

  // Auto-scroll the thread to the bottom on new content.
  createEffect(() => {
    void stream();
    queueMicrotask(() => {
      if (threadEl && !historyOpen()) threadEl.scrollTop = threadEl.scrollHeight;
    });
  });
  // Close history when the active conv changes.
  createEffect(() => { void conv(); setHistoryOpen(false); });

  const stop = async () => {
    const c = conv();
    if (!c || cancelling()) return;
    setCancelling(true);
    try {
      log.info('chat cancel', { conv: c });
      const res = await props.client.chatCancel(c);
      if (!res.ok) log.error('chat cancel failed', res.status, res.body);
    } finally { setCancelling(false); }
  };

  const archive = () => {
    const c = conv();
    if (!c) return;
    chatStore.archiveConv(c);
    chatStore.setActiveConv(null);
  };

  const rename = (next: string) => {
    const c = conv();
    if (!c) return;
    chatStore.setConvTitle(c, next);
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
        />

        <Show when={!historyOpen()} fallback={
          <ChatHistoryView conv={conv()!} onClose={() => setHistoryOpen(false)} />
        }>
          <div ref={threadEl} class="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
            <For each={stream().pre}>
              {(it) => {
                if (it.kind === 'msg') return <MessageBubble msg={it.msg} />;
                if (it.kind === 'tool') return <ToolUseBubble ev={it.ev} />;
                return <TaskLifecycleBubble ev={it.ev} />;
              }}
            </For>
            <For each={stream().queued}>
              {(it) => it.kind === 'msg'
                ? <MessageBubble msg={it.msg} prepend />
                : null}
            </For>
            <Show when={stream().live}>
              <MessageBubble msg={stream().live!} />
            </Show>
          </div>
        </Show>

        <Show when={isRunning()}>
          <div class="px-3 pt-2 flex justify-end border-t border-gray-800/60">
            <button
              type="button"
              onClick={() => void stop()}
              disabled={cancelling()}
              class="px-3 py-1 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 font-semibold text-[11px] transition-colors disabled:opacity-60"
              title="Stop the coordinator. The pending buffer is dropped."
            >{cancelling() ? 'stopping…' : 'Stop'}</button>
          </div>
        </Show>
        <ChatComposer
          client={props.client}
          conv={conv()!}
          placeholder={isRunning()
            ? 'Add more instructions — they go above the live work and get merged into the next turn…'
            : 'Reply…'}
          onDaemonOutdated={openDaemonOutdatedModal}
          onTokenRejected={() => {
            const h = daemonStore.state.health;
            if (!h) return;
            openTokenUnlockModal({
              project: { port: h.port, cluster_id: h.cluster_id ?? null, cluster_name: h.cluster_name ?? null },
              reason: 'Token rejected by /chat/dispatch — paste a fresh one.',
              onUnlocked: (token) => { props.client.transport.token = token; },
            });
          }}
        />
        <Show when={isServiceType(meta()?.type) && msgs().length === 0}>
          <AgentRoleHint type={meta()!.type} />
        </Show>
      </Show>
    </div>
  );
}

function AgentRoleHint(props: { type: import('~/state/chat').AgentType }) {
  const info = () => agentTypeInfo(props.type);
  return (
    <div
      class="mx-3 mb-3 px-3 py-2 rounded-md border text-[11px] leading-snug text-gray-300"
      style={{
        'border-color': `${info().color}40`,
        background: `${info().color}10`,
      }}
    >
      <span class="font-mono text-[10px] mr-1" style={{ color: info().color }}>
        {info().emoji} {info().label} —
      </span>
      <span>{info().role}</span>
    </div>
  );
}

function EmptyChat() {
  return (
    <div class="flex-1 flex items-center justify-center p-8">
      <p class="text-center text-xs text-gray-600 max-w-xs">
        Pick an agent in the rail on the left, or click ＋ to start a new conversation.
      </p>
    </div>
  );
}
