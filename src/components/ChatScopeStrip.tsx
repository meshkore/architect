/**
 * ChatScopeStrip — the row above the chat thread.
 *
 * Shows agent title + edit, plus the two view toggles operators reach
 * for: history (≡) and archive. Renaming uses a local edit state so
 * the inline input only commits on Enter / blur. Archive is hidden
 * inside a confirm-on-second-click affordance to avoid stray taps.
 */

import { Show, createSignal } from 'solid-js';
import type { ConvMeta } from '~/state/chat';
import { agentTypeInfo } from '~/lib/agent-types';

interface Props {
  conv: string;
  meta: ConvMeta | undefined;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onRename: (next: string) => void;
  onArchive: () => void;
}

export default function ChatScopeStrip(props: Props) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [confirmArchive, setConfirmArchive] = createSignal(false);

  const title = () => props.meta?.title?.trim() || props.meta?.agentId || props.conv;
  const typeInfo = () => agentTypeInfo(props.meta?.type);

  const beginEdit = () => {
    setDraft(props.meta?.title ?? '');
    setEditing(true);
  };
  const commit = () => {
    const next = draft().trim();
    setEditing(false);
    if (next !== (props.meta?.title ?? '')) props.onRename(next);
  };

  const armArchive = () => {
    if (confirmArchive()) {
      props.onArchive();
      setConfirmArchive(false);
    } else {
      setConfirmArchive(true);
      setTimeout(() => setConfirmArchive(false), 2400);
    }
  };

  return (
    <div class="flex items-center gap-2 px-2 py-2 border-b border-gray-800/60">
      <Show when={!editing()} fallback={
        <input
          autofocus
          value={draft()}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { setEditing(false); }
          }}
          class="flex-1 bg-gray-950 border border-emerald-500/40 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none"
        />
      }>
        <span
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border"
          style={{
            color: typeInfo().color,
            'border-color': `${typeInfo().color}55`,
            background: `${typeInfo().color}14`,
          }}
          title={`Agent type: ${typeInfo().label}`}
        >
          <span aria-hidden="true">{typeInfo().emoji}</span>
          <span>{typeInfo().label}</span>
        </span>
        <span class="flex-1 text-sm font-mono text-gray-200 truncate">
          {title()}
        </span>
        <span class="text-[10px] font-mono text-gray-600 hidden sm:inline">
          {props.meta?.agentId ?? ''}
          <Show when={props.meta?.model && props.meta!.model !== 'auto'}>
            <span class="text-gray-700"> · {props.meta!.model}</span>
          </Show>
        </span>
      </Show>
      <Show when={!editing()}>
        <button
          type="button"
          onClick={beginEdit}
          class="p-1 rounded text-gray-500 hover:text-emerald-300 hover:bg-gray-800/60"
          title="Rename"
        >✎</button>
        <button
          type="button"
          onClick={props.onToggleHistory}
          class={`p-1 rounded hover:bg-gray-800/60 ${
            props.historyOpen ? 'text-emerald-300' : 'text-gray-500 hover:text-emerald-300'
          }`}
          title="History"
        >≡</button>
        <button
          type="button"
          onClick={armArchive}
          class={`p-1 rounded hover:bg-gray-800/60 ${
            confirmArchive() ? 'text-red-400 bg-red-500/10' : 'text-gray-500 hover:text-red-300'
          }`}
          title={confirmArchive() ? 'Click again to confirm archive' : 'Archive conversation'}
        >🗄</button>
      </Show>
    </div>
  );
}
