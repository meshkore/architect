import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { chatStore, type ChatMsg } from '~/state/chat';
import { MessageBubble, PreparingBubble, ToolUseBubble, TaskLifecycleBubble } from '~/components/ChatBubbles';
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
    </div>
  );
}
