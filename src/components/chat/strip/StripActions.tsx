/**
 * StripActions — the icon row at the right of the chat strip.
 *
 * V104 order: Chat (default-active, the panel's "home") · rename ·
 * History · Role memory · Archive. Archive is single-click (V107.9): a
 * two-step confirm only flipped a faint border colour, so the operator's
 * second click rarely landed and the button read as broken. Archiving is
 * non-destructive — the conv survives under History's Archived filter.
 *
 * The archive button is hidden entirely on the two fixed system agents.
 * That is the first of three defence layers; `chatStore.archiveConv` and
 * `ChatPanel.archive` guard again.
 */

import { Show, type JSX } from 'solid-js';
import { isFixedAgentConv } from '~/state/chat';

const ICON_BTN =
  'inline-flex items-center justify-center w-7 h-7 rounded-md border border-gray-800 '
  + 'text-gray-500 hover:text-gray-200 hover:border-gray-600 transition-colors';
const ICON_BTN_ACTIVE =
  'inline-flex items-center justify-center w-7 h-7 rounded-md '
  + 'border border-emerald-500/45 text-emerald-300 bg-emerald-500/10';
const ICON_BTN_DANGER =
  'inline-flex items-center justify-center w-7 h-7 rounded-md border border-gray-800 '
  + 'text-gray-500 hover:text-red-300 hover:border-red-500/40 transition-colors';

function IconButton(props: {
  onClick: () => void;
  title: string;
  active?: boolean;
  danger?: boolean;
  children: JSX.Element;
}) {
  const cls = (): string => {
    if (props.active) return ICON_BTN_ACTIVE;
    return props.danger ? ICON_BTN_DANGER : ICON_BTN;
  };
  return (
    <button type="button" onClick={props.onClick} class={cls()} title={props.title}>
      <svg
        width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      >
        {props.children}
      </svg>
    </button>
  );
}

export default function StripActions(props: {
  conv: string;
  chatActive: boolean;
  historyOpen: boolean;
  roleLabel: string;
  onGoChat: () => void;
  onRename: () => void;
  onToggleHistory: () => void;
  onOpenRoleMemory?: () => void;
  onArchive: () => void;
}) {
  return (
    <div class="flex items-center gap-1">
      <IconButton onClick={props.onGoChat} active={props.chatActive} title="Chat (current conversation)">
        <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
      </IconButton>
      <IconButton onClick={props.onRename} title="Rename agent">
        <>
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </>
      </IconButton>
      <IconButton onClick={props.onToggleHistory} active={props.historyOpen} title="History (older messages)">
        <>
          <path d="M3 3v5h5" />
          <path d="M3.05 13A9 9 0 106 5.3L3 8" />
          <path d="M12 7v5l4 2" />
        </>
      </IconButton>
      <Show when={props.onOpenRoleMemory}>
        <IconButton
          onClick={() => props.onOpenRoleMemory?.()}
          title={`Role memory — accumulated REMEMBER facts for the ${props.roleLabel} role`}
        >
          <>
            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </>
        </IconButton>
      </Show>
      <Show when={!isFixedAgentConv(props.conv)}>
        <IconButton onClick={props.onArchive} danger title="Archive conversation">
          <>
            <rect x="3" y="4" width="18" height="4" rx="1" />
            <path d="M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8" />
            <path d="M10 12h4" />
          </>
        </IconButton>
      </Show>
    </div>
  );
}
