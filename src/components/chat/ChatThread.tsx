import { For, Show } from 'solid-js';
import type { ChatMsg } from '~/state/chat';
import { MessageBubble, ToolUseBubble, TaskLifecycleBubble } from '~/components/ChatBubbles';
import type { StreamItem } from '~/lib/chat-stream';

export default function ChatThread(props: {
  ref: (el: HTMLDivElement) => void;
  stream: { pre: StreamItem[]; queued: StreamItem[]; live: ChatMsg | null };
}) {
  return (
    <div ref={props.ref} class="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
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
    </div>
  );
}
