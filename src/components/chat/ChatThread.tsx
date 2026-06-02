import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { chatStore, type ChatMsg } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { MessageBubble, PreparingBubble, ToolUseBubble, TaskLifecycleBubble } from '~/components/ChatBubbles';
import { waitingByConv } from '~/state/server';
import type { StreamItem } from '~/lib/chat-stream';

// V89.1 — Hard timeout for the preparing bubble. If no delta / final
// / cancelled arrives within this window after a dispatch, the flag
// is considered stale (likely a WS reconnect that missed the events,
// or a daemon-side hang). The bubble disappears and the operator
// regains the composer instead of staring at "Generando respuesta…"
// forever.
const PREPARING_STALE_MS = 60_000;

export default function ChatThread(props: {
  ref: (el: HTMLDivElement) => void;
  stream: { pre: StreamItem[]; queued: StreamItem[]; live: ChatMsg | null };
}) {
  // 1 Hz wall-clock so the stale check re-evaluates every tick.
  const [nowMs, setNowMs] = createSignal(Date.now());
  onMount(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    onCleanup(() => clearInterval(iv));
  });

  // py-1.11.0 — Lazy-load the active conv's recent messages the first
  // time it gains focus. Messages come from `GET /chat/conv/<id>/messages`
  // (newest 200) instead of the legacy `state.timeline.recent_events`
  // replay. Daemon-authoritative: we don't render anything until the
  // fetch resolves, but the rail card is already painted from
  // `chatStore.state.convs[id]` which arrived in the boot snapshot.
  // Re-fetches only when activeConv changes AND convMap is empty (the
  // WS keeps it fresh after that).
  //
  // V107.24 — `_onboarding_v1` (the Master / Architect Agent since
  // V107.12) is NO LONGER excluded. Pre-V107.12 it was a synthetic
  // local-only conv (the old Coordinator welcome bubble), so fetching
  // its history was wasted work. Now it's the always-on master that
  // persists 48+ real messages on the daemon — skipping it left
  // operators with an empty chat after every reload of a non-MeshKore
  // cluster (Cavioca field report 2026-06-02). The remaining guards
  // below (existing.length > 0, summary.msg_count === 0) already
  // prevent re-fetches for genuinely-empty conversations.
  const loadedConvs = new Set<string>();
  createEffect(() => {
    const conv = chatStore.state.activeConv;
    if (!conv) return;
    if (loadedConvs.has(conv)) return;
    const summary = chatStore.state.convs[conv];
    const existing = chatStore.state.convMap[conv] ?? [];
    if (existing.length > 0) {
      loadedConvs.add(conv);
      return;
    }
    if (!summary) {
      // Snapshot hasn't landed yet — wait. Don't mark loaded so the
      // createEffect re-fires when `convs[conv]` arrives via the boot
      // hydrate path. (V107.24 — guarding against a boot race where
      // seedOnboardingConv runs before chatSnapshot resolves; pre-fix
      // we'd mark loaded here and never re-evaluate, leaving Master
      // empty for the whole session.)
      return;
    }
    if (summary.msg_count === 0) {
      loadedConvs.add(conv);
      return;
    }
    const client = daemonStore.state.client;
    if (!client) return;
    loadedConvs.add(conv);
    void chatStore.loadConvMessagesPage(client, conv, { limit: 200 });
  });

  // V86p — the "preparing" bubble appears when the active conv is in
  // chatStore.pendingReplyConvs AND there's no live assistant bubble
  // yet. As soon as the first chunk arrives ingestEvent clears the
  // flag AND populates props.stream.live, so the two states never
  // double-render. V89.1 — also hides itself after PREPARING_STALE_MS
  // without any event so a hung/lost stream doesn't leave a fake
  // "thinking" forever.
  const preparingAt = (): number | null => {
    const conv = chatStore.state.activeConv;
    if (!conv) return null;
    if (props.stream.live) return null;
    const ts = chatStore.state.pendingReplyConvs[conv];
    if (typeof ts !== 'number') return null;
    if (nowMs() - ts > PREPARING_STALE_MS) return null;
    // V89.1 — Defensive: if the LAST message in the conv is an
    // assistant turn that has already finalised (streaming=false,
    // whether cancelled or done), the pending flag is stale by
    // definition — the agent isn't preparing anything; we just
    // haven't garbage-collected the flag yet. Operator's bug: after
    // Stop, a "coordinator · Generating response…" bubble appeared
    // RIGHT AFTER the cancelled bubble. This rule suppresses it.
    const list = chatStore.state.convMap[conv] ?? [];
    const last = list[list.length - 1];
    if (last && last.kind === 'assistant' && !last.streaming) return null;
    return ts;
  };
  return (
    <div ref={props.ref} class="flex-1 min-h-0 overflow-y-auto p-3 space-y-6">
      <For each={props.stream.pre}>
        {(it) => {
          if (it.kind === 'msg') return <MessageBubble msg={it.msg} />;
          if (it.kind === 'tool') return <ToolUseBubble ev={it.ev} />;
          return <TaskLifecycleBubble ev={it.ev} />;
        }}
      </For>
      <For each={props.stream.queued}>
        {(it) => it.kind === 'msg'
          ? <MessageBubble msg={it.msg} prepend />
          : null}
      </For>
      <Show when={props.stream.live}>
        <MessageBubble msg={props.stream.live!} />
      </Show>
      <Show when={preparingAt()}>
        {(ts) => <PreparingBubble dispatchedAt={ts()} />}
      </Show>
      <Show when={waitingChildren().length > 0 && !preparingAt() && !props.stream.live}>
        <WaitingOnPill children_={waitingChildren()} />
      </Show>
    </div>
  );

  // py-1.11.0 — Resolve the list of child convs this conv is waiting
  // on (subagents whose `parent_conv` points here and are streaming
  // right now). Daemon-authoritative via `chatStore.state.convs[conv].waiting_on`
  // (re-exported by `waitingByConv()` for back-compat). Empty when this
  // conv isn't coordinating.
  function waitingChildren(): Array<{ conv: string; agent_id: string | null }> {
    const conv = chatStore.state.activeConv;
    if (!conv) return [];
    const children = waitingByConv()[conv] ?? [];
    if (children.length === 0) return [];
    return children.map((c) => ({
      conv: c,
      agent_id: chatStore.state.convMeta[c]?.agentId ?? null,
    }));
  }
}

/** Inline pill rendered when the active conv has dispatched subagents
 *  and is waiting for their finals (architect coordinator pattern).
 *  Renders agent ids — clicking one would ideally jump to that conv;
 *  for now it's informational. */
function WaitingOnPill(props: { children_: Array<{ conv: string; agent_id: string | null }> }) {
  const setActive = (conv: string) => chatStore.setActiveConv(conv);
  return (
    <div class="flex items-start gap-2 text-[12px] text-gray-400 pl-2 pt-1">
      <span class="inline-flex items-center gap-1 mt-0.5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:150ms]" />
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:300ms]" />
      </span>
      <span class="flex flex-wrap items-center gap-1.5">
        <span class="text-emerald-300/80">Waiting on</span>
        <For each={props.children_}>
          {(c) => (
            <button
              type="button"
              onClick={() => setActive(c.conv)}
              title={`Open ${c.conv}`}
              class="font-mono text-[11px] px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
            >
              {c.agent_id || c.conv.slice(0, 16)}
            </button>
          )}
        </For>
      </span>
    </div>
  );
}
