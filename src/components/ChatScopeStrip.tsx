/**
 * ChatScopeStrip — the row above the chat thread.
 *
 * V86 — Visual sweep matching the rail's action icons. Shows the
 * agent-ID pill + name + edit pencil. The agent-type chip moved to
 * AgentCard (the rail card) — the operator already sees it there,
 * showing it twice wastes header real estate.
 *
 * The right-side icon row carries four views the operator can flip
 * between:
 *   chat (default) · history (≡) · role-memory (🧠) · archive (🗄)
 *
 * The chat icon is the "return home" affordance when history or any
 * other panel is open; it highlights to show which view is current.
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
  /** M7.7 — open per-type role memory viewer for this agent. */
  onOpenRoleMemory?: () => void;
}

const ICON_BTN =
  'inline-flex items-center justify-center w-7 h-7 rounded-md border border-gray-800 ' +
  'text-gray-500 hover:text-gray-200 hover:border-gray-600 transition-colors';
const ICON_BTN_ACTIVE =
  'inline-flex items-center justify-center w-7 h-7 rounded-md ' +
  'border border-emerald-500/45 text-emerald-300 bg-emerald-500/10';

export default function ChatScopeStrip(props: Props) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [confirmArchive, setConfirmArchive] = createSignal(false);

  const title = () => props.meta?.title?.trim() || props.meta?.agentId || props.conv;
  const typeInfo = () => agentTypeInfo(props.meta?.type);
  const chatActive = () => !props.historyOpen;

  const beginEdit = () => {
    setDraft(props.meta?.title ?? '');
    setEditing(true);
  };
  const commit = () => {
    const next = draft().trim();
    setEditing(false);
    if (next !== (props.meta?.title ?? '')) props.onRename(next);
  };

  // V107.9 — Two-step confirm dropped. Operator complaint 2026-05-30:
  // "el botón de archivar agentes no funciona, completamente ignorado".
  // Root cause: the first click only flipped a faint border color
  // (border-gray-800 → border-red-500/50), so the visual change was
  // imperceptible and the second click (needed within 2.4 s) often
  // never landed. Archive is non-destructive — the conv survives in
  // History under the Archived filter and Restore brings it back —
  // so a single-click action is the right contract.
  const armArchive = () => {
    setConfirmArchive(false);
    props.onArchive();
  };

  /** Chat view = the default. Currently the only way to "leave" the
   *  thread is the history toggle, so clicking the chat icon while
   *  history is open closes it. */
  const goChat = () => { if (props.historyOpen) props.onToggleHistory(); };

  return (
    <div class="flex items-center gap-2 px-2 py-1.5 border-b border-gray-800/60">
      <Show when={!editing()} fallback={
        <>
          {/* V104 — Editing UX rewritten so the operator gets visible
              Save + Cancel affordances. The old design was input-only:
              commit-on-blur + Enter to save + Escape to cancel, all
              invisible shortcuts. Now the input keeps the Enter /
              Escape keys (muscle memory) but also exposes two emerald-
              accented buttons immediately to its right. The input no
              longer commits on blur — only on explicit Save — so the
              operator can click elsewhere to inspect the rest of the
              cockpit without losing the draft. */}
          <input
            autofocus
            value={draft()}
            onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
            placeholder={props.meta?.agentId ? `Rename ${props.meta.agentId}…` : 'Rename agent…'}
            class="flex-1 min-w-0 bg-gray-950 border border-emerald-500/40 rounded px-2 py-1 text-sm text-gray-100 placeholder-gray-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setEditing(false)}
            class="px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider text-gray-400 hover:text-gray-200 border border-gray-800 hover:border-gray-700 transition-colors flex-shrink-0"
            title="Cancel — Escape"
          >Cancel</button>
          <button
            type="button"
            onClick={commit}
            class="px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 transition-colors flex-shrink-0"
            title="Save — Enter"
          >Save</button>
        </>
      }>
        {/* Agent ID pill — same shape as in the AgentCard so the
            operator's eye binds them together. */}
        <span
          class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-200 flex-shrink-0"
          style={{
            background: 'rgba(17,24,39,0.7)',
            border: `1px solid ${typeInfo().color}55`,
          }}
          title={props.meta?.agentId ? `Agent id: ${props.meta.agentId}` : ''}
        >
          {props.meta?.agentId ?? '—'}
        </span>
        <span class="flex-1 text-sm font-semibold text-gray-100 truncate">
          {title()}
        </span>
      </Show>
      <Show when={!editing()}>
        <div class="flex items-center gap-1">
          {/* V104 — Order: Chat (default-active) · Pen rename ·
              History · Role memory · Archive. Operator wanted the
              chat bubble as the FIRST icon since it's the "home"
              of the panel and is active by default; the pen comes
              second because rename is a less-frequent action. */}
          <button type="button" onClick={goChat}
            class={chatActive() ? ICON_BTN_ACTIVE : ICON_BTN}
            title="Chat (current conversation)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
            </svg>
          </button>
          {/* Rename — pencil glyph matches the rail's edit icon. */}
          <button type="button" onClick={beginEdit} class={ICON_BTN} title="Rename agent">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          {/* History */}
          <button type="button" onClick={props.onToggleHistory}
            class={props.historyOpen ? ICON_BTN_ACTIVE : ICON_BTN}
            title="History (older messages)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 3v5h5" />
              <path d="M3.05 13A9 9 0 106 5.3L3 8" />
              <path d="M12 7v5l4 2" />
            </svg>
          </button>
          {/* Role memory — only when the parent provided the callback. */}
          <Show when={props.onOpenRoleMemory}>
            <button type="button" onClick={() => props.onOpenRoleMemory?.()}
              class={ICON_BTN}
              title={`Role memory — accumulated REMEMBER facts for the ${typeInfo().label} role`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          </Show>
          {/* Archive — two-step confirm. */}
          <button type="button" onClick={armArchive}
            class={confirmArchive()
              ? 'inline-flex items-center justify-center w-7 h-7 rounded-md border border-red-500/50 text-red-300 bg-red-500/10'
              : 'inline-flex items-center justify-center w-7 h-7 rounded-md border border-gray-800 text-gray-500 hover:text-red-300 hover:border-red-500/40 transition-colors'}
            title={confirmArchive() ? 'Click again to confirm archive' : 'Archive conversation'}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8" />
              <path d="M10 12h4" />
            </svg>
          </button>
        </div>
      </Show>
    </div>
  );
}
