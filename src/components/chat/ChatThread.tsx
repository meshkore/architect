import { For, Show } from 'solid-js';
import { chatStore, type ChatMsg } from '~/state/chat';
import { MessageBubble, PreparingBubble, ToolUseBubble, TaskLifecycleBubble } from '~/components/ChatBubbles';
import type { StreamItem } from '~/lib/chat-stream';

export default function ChatThread(props: {
  ref: (el: HTMLDivElement) => void;
  stream: { pre: StreamItem[]; queued: StreamItem[]; live: ChatMsg | null };
}) {
  // V86p — the "preparing" bubble appears when the active conv is in
  // chatStore.pendingReplyConvs AND there's no live assistant bubble
  // yet. As soon as the first chunk arrives ingestEvent clears the
  // flag AND populates props.stream.live, so the two states never
  // double-render.
  const preparingAt = (): number | null => {
    const conv = chatStore.state.activeConv;
    if (!conv) return null;
    if (props.stream.live) return null;
    const ts = chatStore.state.pendingReplyConvs[conv];
    return typeof ts === 'number' ? ts : null;
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
