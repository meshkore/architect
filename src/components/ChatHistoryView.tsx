/**
 * ChatHistoryView — swaps in over the chat thread when the operator
 * clicks ≡ in the scope strip.
 *
 * Two sections:
 *   1. Past turns of the active conversation — every assistant.final
 *      bubble, newest first, click to scroll the thread to that turn.
 *   2. Archived conversations — restore (unarchive) to re-rail them.
 */

import { For, Show, createMemo } from 'solid-js';
import { chatStore, type ChatMsg } from '~/state/chat';

interface Props {
  conv: string;
  onClose: () => void;
  onJumpToTurn?: (streamId: string) => void;
}

interface Turn {
  streamId: string;
  ts: string;
  preview: string;
}

function turnsOf(conv: string): Turn[] {
  const list: ChatMsg[] = chatStore.state.convMap[conv] ?? [];
  const out: Turn[] = [];
  for (const m of list) {
    if (m.kind !== 'assistant') continue;
    if (m.streaming) continue;
    if (!m.stream_id) continue;
    out.push({
      streamId: m.stream_id,
      ts: m.ts ?? '',
      preview: m.text.split('\n').find((ln) => ln.trim().length > 0)?.slice(0, 120) ?? '(empty)',
    });
  }
  return out.reverse();
}

export default function ChatHistoryView(props: Props) {
  const turns = createMemo(() => turnsOf(props.conv));
  const archived = createMemo(() => Object.keys(chatStore.state.archivedConvs));

  return (
    <div class="flex-1 min-h-0 overflow-y-auto bg-gray-950/40 border border-gray-800/60 rounded-lg p-3 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-mono uppercase tracking-wider text-gray-400">History</h3>
        <button
          type="button"
          onClick={props.onClose}
          class="text-[11px] text-gray-500 hover:text-emerald-300"
        >back to thread</button>
      </div>

      <section class="space-y-1">
        <h4 class="text-[10px] font-mono uppercase tracking-wider text-gray-600">
          Past turns ({turns().length})
        </h4>
        <Show when={turns().length > 0} fallback={
          <p class="text-xs text-gray-600 italic">No completed turns yet.</p>
        }>
          <ul class="space-y-1">
            <For each={turns()}>
              {(t) => (
                <li>
                  <button
                    type="button"
                    onClick={() => props.onJumpToTurn?.(t.streamId)}
                    class="w-full text-left px-2 py-1.5 rounded text-xs bg-gray-900/50 hover:bg-gray-900 border border-gray-800/60 transition-colors group"
                  >
                    <div class="font-mono text-[10px] text-gray-600 group-hover:text-gray-500 mb-0.5">
                      {t.ts || '—'}
                    </div>
                    <div class="text-gray-300 truncate">{t.preview}</div>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class="space-y-1">
        <h4 class="text-[10px] font-mono uppercase tracking-wider text-gray-600">
          Archived ({archived().length})
        </h4>
        <Show when={archived().length > 0} fallback={
          <p class="text-xs text-gray-600 italic">No archived conversations.</p>
        }>
          <ul class="space-y-1">
            <For each={archived()}>
              {(c) => {
                const meta = chatStore.state.convMeta[c];
                const label = meta?.title?.trim() || meta?.agentId || c;
                return (
                  <li class="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-900/40 border border-gray-800/60">
                    <span class="flex-1 text-xs text-gray-300 truncate">{label}</span>
                    <button
                      type="button"
                      onClick={() => chatStore.unarchiveConv(c)}
                      class="text-[10px] text-emerald-400 hover:text-emerald-300"
                    >restore</button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}
