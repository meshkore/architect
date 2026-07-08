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

import { For, Show, createMemo, createSignal } from 'solid-js';
import { chatStore, ONBOARDING_CONV_ID, isFixedAgentConv, type ConvMeta } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { teamStore } from '~/state/team';
import { agentVisualInfo } from '~/lib/agent-types';
import { MODEL_CATALOG, EFFORT_CATALOG } from '~/lib/models';
import { clientsStore } from '~/state/clients';
import type { ChatContextBlock, TeamMember } from '~/lib/daemon-client';
import { debugDropCount } from '~/lib/debug-transport';
import { log } from '~/lib/log';

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
  // py-1.10.24 — Use conv-aware visual lookup so the onboarding conv
  // shows as Master Architect (👑 pink) and roadmap-architect slugs
  // render with the cyan cap even if conv_meta has drifted.
  const typeInfo = () => agentVisualInfo(props.conv, props.meta);
  const chatActive = () => !props.historyOpen;

  // ATM12 follow-up (2026-07-07 operator correction) — moved out of the
  // Agents column header and into a second line under THIS agent's own
  // name/model row, shown only while that fixed agent is selected.
  const fixedNote = (): string | null => {
    if (props.conv === ONBOARDING_CONV_ID) {
      return 'Fixed system agent — plans only (roadmap, context, links, crons). Never writes code.';
    }
    if (isFixedAgentConv(props.conv)) {
      return 'Fixed system agent — executes the queue and may dispatch agents. Never writes code itself.';
    }
    return null;
  };

  // ATM7 — the roster member this conv is bound to (developer, …), and
  // whether it's still a DRAFT (no messages yet). Member + name are
  // editable while draft; frozen to a read-only badge after the first
  // dispatch. Onboarding is never a draft (it's the always-on master).
  const boundMember = () => teamStore.get(props.meta?.member);
  const isDraft = (): boolean => {
    if (props.conv === ONBOARDING_CONV_ID) return false;
    const msgs = chatStore.state.convMap[props.conv] ?? [];
    return !msgs.some((m) => m.kind === 'user' || m.kind === 'assistant');
  };
  const rebindMember = (id: string): void => {
    const m = teamStore.get(id);
    chatStore.setConvMember(props.conv, id, {
      model: m?.model,
      effort: m?.effort,
      // Only rename if the title still matches the previous member's name
      // (operator hasn't typed a custom one).
      title: props.meta?.title === boundMember()?.name ? m?.name : undefined,
    });
  };

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

  // V107.20 — Persistent STOP in the header. The inline ■ stop on
  // BubbleHeader only shows while a streaming assistant bubble is
  // visible. But the agent stays "live" through tool calls, file
  // edits, and subagent coordination — moments where no streaming
  // bubble is on screen yet the operator might want to halt. Read
  // daemon-authoritative `live` + `coordinating` from chat.snapshot
  // (py-1.11.0+) so this button mirrors ground truth, not just the
  // local streaming flag.
  const convState = createMemo(() => chatStore.state.convs[props.conv] ?? null);
  const isWorking = (): boolean => {
    const c = convState();
    if (c && (c.live || c.coordinating)) return true;
    // Fallback for daemons predating chat.snapshot.v1: check the
    // local convMap for a streaming assistant bubble.
    const msgs = chatStore.state.convMap[props.conv] ?? [];
    const last = msgs[msgs.length - 1];
    return !!(last && last.kind === 'assistant' && last.streaming && !last.cancelled);
  };
  const stopLabel = (): string => (convState()?.coordinating ? 'STOP all' : 'STOP');
  const stopTitle = (): string => {
    const c = convState();
    if (c?.coordinating) {
      return `Coordinating ${c.waiting_on?.length ?? 0} subagent(s) — cancels THIS agent's turn (subagents continue unless they're on their own STOP)`;
    }
    return 'Stop this turn — sends SIGTERM to the agent process. Any tool call already in flight (file write, bash) may finish before the kill lands.';
  };
  const [stopping, setStopping] = createSignal(false);
  const onStop = async (): Promise<void> => {
    const client = daemonStore.state.client;
    if (!client) return;
    setStopping(true);
    try {
      const r = await client.chatCancel(props.conv);
      if (!r.ok) log.warn('[chat-scope-strip:stop] /chat/cancel failed', r.status);
    } finally {
      // Hold the "stopping…" state for ~1s so the operator gets
      // visible feedback before the live signal flips off via WS.
      setTimeout(() => setStopping(false), 1000);
    }
  };

  return (
    <div class="flex flex-col border-b border-gray-800/60">
    <div class="flex items-center gap-2 px-2 py-1.5">
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
        {/* 2026-06-12 — leading pill shows the agent TYPE initial, not
            the ID. The ID (A001…) is hidden from the chat wall per
            operator request — it stays internal (diaries, logs, WS).
            The colour still binds to the agent type. */}
        <span
          class="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0"
          style={{
            background: 'rgba(17,24,39,0.7)',
            // color-mix, not a hex+alpha string concat — typeInfo().color
            // is a bare hex for most types but a `var(--theme-...)` ref
            // for the two fixed system agents (ATM12 follow-up).
            border: `1px solid color-mix(in srgb, ${typeInfo().color} 33%, transparent)`,
            color: typeInfo().color,
            'min-width': '20px',
          }}
          title={`${typeInfo().label}${props.meta?.agentId ? ` · ${props.meta.agentId}` : ''}`}
        >
          {(() => {
            const src = (typeInfo().shortLabel ?? typeInfo().label).trim();
            if (!src) return '·';
            return src.length <= 2 ? src.toUpperCase() : src[0]!.toUpperCase();
          })()}
        </span>
        {/* ATM7 — member identity: emoji + NAME. Dropdown while the conv
            is a draft (no messages), read-only badge after first dispatch.
            This tells the operator which init prompt the instance got. */}
        <Show when={props.meta?.member}>
          <Show
            when={isDraft()}
            fallback={
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-gray-100 bg-gray-800/60 border border-gray-700/60 flex-shrink-0"
                title={`Member: ${boundMember()?.name ?? props.meta?.member} — frozen after the first message`}
              >
                <span aria-hidden="true">{boundMember()?.emoji ?? '🤖'}</span>
                <span class="truncate max-w-[120px]">{boundMember()?.name ?? props.meta?.member}</span>
              </span>
            }
          >
            <MemberPicker current={props.meta!.member!} onPick={rebindMember} />
          </Show>
        </Show>
        <span class="flex-1 text-sm font-semibold text-gray-100 truncate">
          {title()}
        </span>
        {/* ATM7 — Model + Effort are LIVE pickers, editable for the whole
            life of the conv. Every turn is a fresh `claude -p`, so a
            change applies from the NEXT message. Persisted to conv_meta
            (chatStore.setConvModel/Effort) and sent in the next dispatch.
            Daemon-authoritative (chat.snapshot) value wins on first paint;
            once the operator picks, convMeta carries it forward. */}
        {(() => {
          const modelId = () => convState()?.model ?? props.meta?.model ?? 'auto';
          const effortId = () => convState()?.effort ?? props.meta?.effort ?? 'default';
          // DM-CLI-08 (multi-cli-clients) — resolve which CLI this conv
          // runs on so the pickers below show THAT client's real
          // catalog, not always claude-code's. Read-only here (the
          // client itself is set on the member, not per-turn from this
          // strip) — same daemon-authoritative-then-local-override
          // precedence as model/effort above.
          const clientId = () => convState()?.client ?? props.meta?.client ?? 'claude-code';
          const isClaudeCode = () => clientId() === 'claude-code';
          const catalog = () => clientsStore.catalogFor(clientId());
          return (
            <div class="flex items-center gap-1 flex-shrink-0">
              <Show
                when={isClaudeCode()}
                fallback={
                  <select
                    value={modelId()}
                    onChange={(e) => chatStore.setConvModel(props.conv, e.currentTarget.value)}
                    title={`Model — applies from the next turn (${clientId()})`}
                    class="bg-purple-500/10 border border-purple-500/30 rounded px-1.5 py-0.5 text-[10px] font-mono text-purple-200 focus:outline-none focus:border-purple-400/60 max-w-[110px]"
                  >
                    <For each={catalog().models}>{(m) => <option value={m.id}>{m.label}</option>}</For>
                  </select>
                }
              >
                <select
                  value={modelId()}
                  onChange={(e) => chatStore.setConvModel(props.conv, e.currentTarget.value)}
                  title="Model — applies from the next turn (daemon launches claude-code --model)"
                  class="bg-purple-500/10 border border-purple-500/30 rounded px-1.5 py-0.5 text-[10px] font-mono text-purple-200 focus:outline-none focus:border-purple-400/60 max-w-[110px]"
                >
                  <For each={['Latest (alias)', 'Pinned version', 'Auto'] as const}>{(grp) => (
                    <optgroup label={grp}>
                      <For each={MODEL_CATALOG.filter((m) => m.group === grp)}>
                        {(m) => <option value={m.id}>{m.label}</option>}
                      </For>
                    </optgroup>
                  )}</For>
                </select>
              </Show>
              <select
                value={effortId()}
                onChange={(e) => chatStore.setConvEffort(props.conv, e.currentTarget.value)}
                title="Effort (reasoning depth) — applies from the next turn"
                class="bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 text-[10px] font-mono text-amber-200/90 focus:outline-none focus:border-amber-400/60"
              >
                <For each={isClaudeCode() ? EFFORT_CATALOG : catalog().efforts}>
                  {(e) => <option value={e.id}>{e.label}</option>}
                </For>
              </select>
            </div>
          );
        })()}
        {/* CU1 (2026-06-12) — token usage + cost chip. Hidden until the
            first turn finalises (daemon emits chat.usage after every
            chat.assistant.final, py-1.13.3+). Cumulative per-conv;
            resets on daemon restart (persistence is `usage-ledger`
            territory). */}
        <Show when={convState()?.usage}>
          {(usage) => {
            const u = usage();
            const fmt = (n: number): string =>
              n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
              : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
              : `${n}`;
            const cost = (u.cost_usd ?? 0).toFixed(2);
            const tooltip =
              `${u.turns} turns · ${u.input_tokens} input · ${u.output_tokens} output · `
              + `${u.cache_read_input_tokens} cache-read · ${u.cache_creation_input_tokens} cache-write · `
              + `$${u.cost_usd.toFixed(4)}`;
            return (
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-300 bg-gray-800/60 border border-gray-700/50 flex-shrink-0"
                title={tooltip}
              >
                <span class="text-gray-400">↓</span>
                <span>{fmt(u.input_tokens)}</span>
                <span class="text-gray-400">↑</span>
                <span>{fmt(u.output_tokens)}</span>
                <span class="text-gray-500">·</span>
                <span class="text-emerald-300">${cost}</span>
              </span>
            );
          }}
        </Show>
        {/* CTX1 (daemon py-1.28.0) — context-window fill gauge (the little
            circle). Painted from the last turn's `context` block when the
            runtime has a known window (claude-code). The ring fills with the
            ratio; it goes amber once `should_compact` (≥50%) so the operator
            sees a turn ran hot. Hidden for runtimes with no known window. */}
        <Show when={convState()?.context?.fill_ratio != null}>
          {() => {
            const c = (): ChatContextBlock => convState()!.context!;
            const pct = (): number => Math.round((c().fill_ratio ?? 0) * 100);
            const hot = (): boolean => !!c().should_compact;
            // Conic-gradient ring: filled arc + track. Amber when hot, else emerald.
            const ring = (): string => {
              const deg = Math.round((c().fill_ratio ?? 0) * 360);
              const fill = hot() ? '#f59e0b' : '#34d399';
              return `conic-gradient(${fill} ${deg}deg, rgba(75,85,99,0.4) ${deg}deg)`;
            };
            const tip = (): string =>
              `Context window: ${pct()}% full `
              + `(${c().prompt_tokens.toLocaleString()} / ${(c().window ?? 0).toLocaleString()} tokens, `
              + `${c().platform})`
              + (hot() ? ' — running hot; will compact at next turn boundary.' : '.');
            return (
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0 border"
                classList={{
                  'text-amber-200 bg-amber-500/10 border-amber-500/30': hot(),
                  'text-gray-300 bg-gray-800/60 border-gray-700/50': !hot(),
                }}
                title={tip()}
              >
                <span
                  class="inline-block w-3 h-3 rounded-full"
                  style={{ background: ring() }}
                  aria-hidden="true"
                />
                <span>{pct()}%</span>
              </span>
            );
          }}
        </Show>
        {/* V50 — debug-stream overflow badge. Shows when the cockpit's
            in-memory buffer for `/debug/log` has dropped events
            (daemon unreachable or rejecting). Clears the moment the
            buffer fully drains again. Operator-visible signal that the
            interleaved daemon+cockpit tail is incomplete. */}
        <Show when={debugDropCount() > 0}>
          <span
            class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-200 bg-amber-500/10 border border-amber-500/30 flex-shrink-0"
            title={`Debug stream: ${debugDropCount()} event(s) dropped (buffer overflow). The daemon is unreachable or rejecting — /debug/tail will have gaps until the buffer drains.`}
          >
            ⚠ debug-drops {debugDropCount()}
          </span>
        </Show>
        {/* V107.20 — Persistent STOP. Visible whenever the conv is
            daemon-authoritative `live` OR `coordinating`. The inline
            ■ stop on streaming bubbles is kept as a redundant control
            for visual proximity; this one survives tool calls, idle
            tool-use gaps, and subagent coordination — moments where
            the streaming bubble is absent but the agent is still
            burning CPU / making file edits / spending tokens. */}
        <Show when={isWorking()}>
          <button
            type="button"
            onClick={() => { void onStop(); }}
            disabled={stopping()}
            title={stopTitle()}
            class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider text-red-200 bg-red-500/15 border border-red-500/50 hover:bg-red-500/25 hover:border-red-500/70 active:bg-red-500/35 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-wait"
          >
            <span class="inline-block w-1.5 h-1.5 rounded-sm bg-red-300" aria-hidden="true" />
            {stopping() ? 'stopping…' : stopLabel()}
          </button>
        </Show>
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
          {/* Archive — single-click (V107.9). Hidden entirely on the two
              fixed system agents (Architect Agent + the live Roadmap
              Architect conv) per V107.12 (extended): neither must ever
              be archivable. The hardcoded guard chain is defense-in-depth:
                1. button hidden here so the operator can't trigger it.
                2. chatStore.archiveConv() returns early for isFixedAgentConv.
                3. ChatPanel.archive() guards before calling /chat/archive. */}
          <Show when={!isFixedAgentConv(props.conv)}>
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
          </Show>
        </div>
      </Show>
    </div>
    <Show when={fixedNote()}>
      {/* 2nd correction (2026-07-07) — pushed flush right (was left-
          aligned under the name) + a real bottom margin (was only
          the box's own padding, no visible gap before the thread
          below). Colour switched off the rejected orange/red onto
          the theme's own accent — same reasoning as AgentCard's pill. */}
      <p
        class="px-2.5 pb-1.5 mb-1.5 text-[10px] leading-snug text-right"
        style={{ color: 'var(--theme-accent-bright, #34d399)' }}
      >
        {fixedNote()}
      </p>
    </Show>
    </div>
  );
}

/** ATM7 — draft-only member picker. Lists pickable members (singletons
 *  with a live instance are hidden) plus the currently-bound member so
 *  it always stays selectable. */
function MemberPicker(props: { current: string; onPick: (id: string) => void }) {
  const options = createMemo<TeamMember[]>(() => {
    const list = teamStore.pickable();
    const cur = teamStore.get(props.current);
    if (cur && !list.some((m) => m.id === cur.id)) return [cur, ...list];
    return list;
  });
  return (
    <select
      value={props.current}
      onChange={(e) => props.onPick(e.currentTarget.value)}
      title="Member — the init prompt this instance receives (editable until the first message)"
      class="bg-gray-800/60 border border-gray-700/60 rounded px-1.5 py-0.5 text-[11px] text-gray-100 focus:outline-none focus:border-emerald-500/55 flex-shrink-0 max-w-[150px]"
    >
      <For each={options()}>
        {(m) => <option value={m.id}>{m.emoji} {m.name}</option>}
      </For>
    </select>
  );
}
