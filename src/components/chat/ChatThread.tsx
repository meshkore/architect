import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { chatStore, INITIAL_PAGE, isAutonomousConv, type ChatMsg } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { MessageBubble, PreparingBubble, ToolUseBubble, TaskLifecycleBubble, AutonomousRun } from '~/components/ChatBubbles';
import { waitingByConv } from '~/state/server';
import { groupAutonomous, type StreamItem } from '~/lib/chat-stream';

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
  // V107.36 — Track convs whose initial history fetch is mid-flight so
  // the body can render a loader instead of a blank wall. Operator
  // field report 2026-06-08: refreshing the page with a non-empty
  // conv showed empty chat for ~1s while /chat/conv/.../messages
  // round-tripped — read as broken because there was no signal.
  const [loadingConvs, setLoadingConvs] = createSignal<Set<string>>(new Set());
  const isLoadingActive = (): boolean => {
    const c = chatStore.state.activeConv;
    return !!c && loadingConvs().has(c);
  };
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
    // V107.36 — flag in-flight; clear on completion (success OR fail).
    setLoadingConvs((s) => { const n = new Set(s); n.add(conv); return n; });
    // 2026-06-12 — windowed history: load only the newest INITIAL_PAGE
    // messages on focus (was 200). A long conv has hundreds of
    // persisted turns; rendering them all froze the panel + scrolled
    // from the top. The scroll-up handler below loads older pages on
    // demand, hard-capped at UI_MESSAGE_CAP.
    void chatStore.loadConvMessagesPage(client, conv, { limit: INITIAL_PAGE }).finally(() => {
      setLoadingConvs((s) => { const n = new Set(s); n.delete(conv); return n; });
    });
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
  // V107.36 — Show loader when the active conv's history is being
  // fetched AND no bubbles are visible yet. Hides automatically when
  // the fetch resolves and messages start populating convMap.
  const showLoader = (): boolean => {
    if (!isLoadingActive()) return false;
    if (props.stream.pre.length > 0) return false;
    if (props.stream.queued.length > 0) return false;
    if (props.stream.live) return false;
    return true;
  };

  // 2026-06-20 — autonomous (continuous-timeline) mode for self-driving
  // agents (roadmap-architect "Run all"). Consecutive agent finals render
  // under ONE header; operator messages break the run inline. See
  // chat-stream.groupAutonomous + ChatBubbles.AutonomousRun.
  const autonomous = (): boolean => isAutonomousConv(chatStore.state.activeConv);
  const segments = () => groupAutonomous(props.stream.pre, props.stream.live);

  // 2026-06-12 — windowed history scroll-up loader. When the operator
  // scrolls within SCROLL_TRIGGER_PX of the top AND there are older
  // pages, fetch the next PAGE and prepend it — preserving the visual
  // scroll position so the viewport doesn't jump (anchor on the
  // scrollHeight delta). Stops at UI_MESSAGE_CAP (paging.capped).
  let scrollEl: HTMLDivElement | undefined;
  const SCROLL_TRIGGER_PX = 80;
  const paging = () => {
    const c = chatStore.state.activeConv;
    return c ? chatStore.state.paging[c] : undefined;
  };
  const onScroll = (): void => {
    if (!scrollEl) return;
    if (scrollEl.scrollTop > SCROLL_TRIGGER_PX) return;
    const conv = chatStore.state.activeConv;
    const client = daemonStore.state.client;
    const p = paging();
    if (!conv || !client || !p || !p.hasMore || p.loading || p.capped) return;
    const prevHeight = scrollEl.scrollHeight;
    const prevTop = scrollEl.scrollTop;
    void chatStore.loadEarlierMessages(client, conv).then((added) => {
      if (added > 0 && scrollEl) {
        // Preserve the viewport: new content was prepended, so shift
        // scrollTop down by the height that got added above.
        requestAnimationFrame(() => {
          if (!scrollEl) return;
          scrollEl.scrollTop = prevTop + (scrollEl.scrollHeight - prevHeight);
        });
      }
    });
  };

  return (
    <div
      ref={(el) => { scrollEl = el; props.ref(el); }}
      onScroll={onScroll}
      class="flex-1 min-h-0 overflow-y-auto p-3 space-y-6"
    >
      <Show when={showLoader()}>
        <ChatLoadingPlaceholder />
      </Show>
      {/* 2026-06-12 — windowed history affordances at the top of the
          thread. While an older page loads: a spinner. When the UI
          cap is hit: a thin notice (the history isn't deleted — just
          not painted past UI_MESSAGE_CAP to keep the panel snappy). */}
      <Show when={paging()?.loading}>
        <div class="flex items-center justify-center gap-2 py-2 text-[11px] text-gray-500">
          <span class="inline-block w-3 h-3 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          Loading earlier messages…
        </div>
      </Show>
      <Show when={paging()?.capped && !paging()?.loading}>
        <div class="text-center py-2 text-[11px] text-gray-600">
          — showing the latest messages · full history remains on the daemon —
        </div>
      </Show>
      <Show
        when={autonomous()}
        fallback={
          <>
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
              <div data-live-bubble="1">
                <MessageBubble msg={props.stream.live!} />
              </div>
            </Show>
          </>
        }
      >
        {/* Continuous timeline: runs of agent finals under one header,
            operator messages inline as their own break. The live final
            tails its run (data-live-bubble lives inside AutonomousRun). */}
        <For each={segments()}>
          {(seg) => {
            if (seg.kind === 'run') return <AutonomousRun msgs={seg.msgs} />;
            if (seg.kind === 'msg') return <MessageBubble msg={seg.msg} />;
            if (seg.kind === 'tool') return <ToolUseBubble ev={seg.ev} />;
            return <TaskLifecycleBubble ev={seg.ev} />;
          }}
        </For>
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

/** V107.36 — Chat history loader. Renders when activeConv has
 *  msg_count > 0 in the daemon snapshot but convMap is still empty
 *  (the initial /chat/conv/<id>/messages fetch is mid-flight). Three
 *  pulsing skeleton bars + label. Hides automatically once the first
 *  message lands or the fetch errors. */
function ChatLoadingPlaceholder() {
  return (
    <div class="flex flex-col gap-3 px-2 pt-4 opacity-70" aria-label="Loading chat history">
      <div class="flex items-center gap-2 text-[11px] text-gray-500 font-mono uppercase tracking-wider">
        <span class="inline-flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:150ms]" />
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft [animation-delay:300ms]" />
        </span>
        <span>Loading chat history…</span>
      </div>
      {/* Skeleton bubbles — 3 graduated heights so it reads as "messages
          are coming" rather than a single rectangle. */}
      <div class="flex flex-col gap-3 mt-2">
        <div class="h-3 w-1/4 rounded bg-gray-800/60 animate-pulse-soft" />
        <div class="h-4 w-11/12 rounded bg-gray-800/40 animate-pulse-soft [animation-delay:80ms]" />
        <div class="h-4 w-9/12 rounded bg-gray-800/40 animate-pulse-soft [animation-delay:160ms]" />
        <div class="h-4 w-10/12 rounded bg-gray-800/40 animate-pulse-soft [animation-delay:240ms]" />
        <div class="h-3 w-2/12 rounded bg-gray-800/60 animate-pulse-soft [animation-delay:320ms] mt-3" />
        <div class="h-4 w-8/12 rounded bg-gray-800/40 animate-pulse-soft [animation-delay:400ms]" />
        <div class="h-4 w-11/12 rounded bg-gray-800/40 animate-pulse-soft [animation-delay:480ms]" />
      </div>
    </div>
  );
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
