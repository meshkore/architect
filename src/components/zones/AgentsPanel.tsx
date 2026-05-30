/**
 * AgentsPanel — V88. Global view of "who is working on what".
 *
 * Two stacked tables:
 *
 *  1. Runs (top, only when any are in flight) — every active story run
 *     with progress, the agent assigned, the initiative + current
 *     task, elapsed timer, and a stop button.
 *
 *  2. Agents (always) — every conv in `chatStore.convMeta` (excluding
 *     archived) sorted by activity. Per row: id chip · title · type ·
 *     status (idle/streaming) · current task if in a run · last message
 *     preview · "open chat" button that activates the conv.
 *
 * The panel reads from existing stores — no daemon changes needed.
 * It's the operator's answer to "necesito ver la lista de agentes y
 * qué tarea están haciendo, con relación a la iniciativa".
 *
 * Future evolution: when the daemon RunCoordinator lands (audit fases
 * 2-3, captured in initiative `agent-run-coordinator`), this panel
 * will read agent.busy / current_run_id directly from the daemon
 * instead of deriving from convMap+storyStore. The component contract
 * doesn't change.
 */

import { For, Show, createMemo } from 'solid-js';
import { chatStore, ONBOARDING_CONV_ID, type ConvMeta } from '~/state/chat';
import { storyStore } from '~/state/story';
import { daemonStore } from '~/state/daemon';
import { allTasks, allInitiatives } from '~/state/server';
import { uiStore } from '~/state/ui';
import { log } from '~/lib/log';

interface AgentRow {
  conv: string;
  meta: ConvMeta;
  status: 'idle' | 'streaming';
  lastTs: string | null;
  lastText: string | null;
  runInitiativeId: string | null;
  runTaskId: string | null;
  isOnboarding: boolean;
}

function isStreaming(conv: string): boolean {
  const list = chatStore.state.convMap[conv] ?? [];
  const last = list[list.length - 1];
  return !!(last && last.kind === 'assistant' && last.streaming);
}

function lastMessage(conv: string): { ts: string | null; text: string | null } {
  const list = chatStore.state.convMap[conv] ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i]!;
    if (m._placeholder || m._placeholder_user) continue;
    return { ts: m.ts ?? null, text: m.text ?? null };
  }
  return { ts: null, text: null };
}

function fmtRelative(ts: string | null): string {
  if (!ts) return '—';
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function typeBadge(t: ConvMeta['type']): string {
  return t === 'custom' ? 'agent' : t;
}

export default function AgentsPanel() {
  const activeRuns = createMemo(() => storyStore.state.runs.filter(
    (r) => r.status !== 'done' && r.status !== 'cancelled' && r.status !== 'failed',
  ));

  const rows = createMemo<AgentRow[]>(() => {
    const out: AgentRow[] = [];
    const runsByConv = new Map(activeRuns().map((r) => [r.conv, r]));
    for (const [conv, meta] of Object.entries(chatStore.state.convMeta)) {
      if (chatStore.state.archivedConvs[conv]) continue;
      const run = runsByConv.get(conv) ?? null;
      const { ts, text } = lastMessage(conv);
      out.push({
        conv,
        meta,
        status: isStreaming(conv) ? 'streaming' : 'idle',
        lastTs: ts,
        lastText: text,
        runInitiativeId: run?.initiativeId ?? null,
        runTaskId: run ? (run.taskIds[run.cursor] ?? null) : null,
        isOnboarding: conv === ONBOARDING_CONV_ID,
      });
    }
    out.sort((a, b) => {
      const aRun = a.runInitiativeId ? 1 : 0;
      const bRun = b.runInitiativeId ? 1 : 0;
      if (aRun !== bRun) return bRun - aRun;
      const aStream = a.status === 'streaming' ? 1 : 0;
      const bStream = b.status === 'streaming' ? 1 : 0;
      if (aStream !== bStream) return bStream - aStream;
      const aTs = a.lastTs ? Date.parse(a.lastTs) : 0;
      const bTs = b.lastTs ? Date.parse(b.lastTs) : 0;
      return bTs - aTs;
    });
    return out;
  });

  const runRows = createMemo(() => {
    return activeRuns().map((r) => {
      const init = allInitiatives().find((i) => i.id === r.initiativeId);
      const task = allTasks().find((t) => t.id === r.taskIds[r.cursor]);
      return {
        run: r,
        initiativeTitle: init?.title ?? r.initiativeTitle ?? r.initiativeId,
        taskTitle: task?.title ?? r.taskIds[r.cursor] ?? '—',
        agentId: r.agentId ?? '—',
      };
    });
  });

  const stopRun = async (runId: string): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c) return;
    const ok = await storyStore.cancel(c, runId);
    if (!ok) log.warn('agents panel: cancel failed', runId);
  };

  const goToChat = (conv: string): void => {
    chatStore.setActiveConv(conv);
    uiStore.setActiveZone('architect');
  };

  // V107.9 — Archive directly from the list. Operator complaint:
  // having to switch chat then double-click the trash icon to clear
  // 3 agents was unworkable. Now a small × on each row archives
  // immediately (one click). Onboarding/Coordinator stays unarchivable
  // — guarded by chatStore.archiveConv.
  const archiveConv = async (conv: string): Promise<void> => {
    log.warn('[agents-panel:archive] start', { conv });
    chatStore.archiveConv(conv);
    log.warn('[agents-panel:archive] local archiveConv done', {
      conv,
      archivedNow: chatStore.state.archivedConvs[conv] === true,
    });
    if (chatStore.state.activeConv === conv) chatStore.setActiveConv(null);
    const client = daemonStore.state.client;
    if (!client) {
      log.warn('[agents-panel:archive] no daemon client — local-only');
      return;
    }
    const res = await client.chatArchive(conv);
    log.warn('[agents-panel:archive] /chat/archive', { ok: res.ok, status: res.status });
    if (!res.ok) log.warn('[agents-panel:archive] sync to daemon failed', res.status);
  };

  return (
    <section class="zone-host p-4 overflow-y-auto">
      <header class="mb-4">
        <h2 class="text-sm font-mono uppercase tracking-wider text-gray-400">Agents</h2>
        <p class="text-[11px] text-gray-600 mt-0.5">
          Every chat agent on this cluster. Active story runs surface
          on top; click an agent to open its chat.
        </p>
      </header>

      <Show when={runRows().length > 0}>
        <section class="mb-6">
          <h3 class="text-[10px] font-mono uppercase tracking-wider text-emerald-400/80 mb-2">
            Active runs · {runRows().length}
          </h3>
          <ul class="space-y-2">
            <For each={runRows()}>
              {(rr) => (
                <li class="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                  <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span class="font-mono text-[10px] text-emerald-300 bg-emerald-500/15 border border-emerald-500/40 rounded px-1.5 py-0.5">
                      {rr.agentId}
                    </span>
                    <span class="text-[11px] text-gray-400 truncate" title={rr.run.conv}>
                      → {rr.initiativeTitle}
                    </span>
                    <span class="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-emerald-300">
                      <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                      {Math.min(rr.run.cursor + 1, rr.run.taskIds.length)}/{rr.run.taskIds.length}
                    </span>
                  </div>
                  <p class="text-[12px] text-gray-200 truncate mb-2">
                    <span class="font-mono text-[10px] text-gray-500 mr-1.5">
                      step {Math.min(rr.run.cursor + 1, rr.run.taskIds.length)}:
                    </span>
                    {rr.taskTitle}
                  </p>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => goToChat(rr.run.conv)}
                      class="text-[10px] font-mono uppercase tracking-wider text-emerald-300/80 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1 transition-colors"
                    >
                      Open chat
                    </button>
                    <button
                      type="button"
                      onClick={() => void stopRun(rr.run.id)}
                      class="text-[10px] font-mono uppercase tracking-wider text-red-300/90 hover:text-red-200 border border-red-500/30 hover:border-red-500/60 rounded px-2 py-1 transition-colors"
                    >
                      ■ Stop
                    </button>
                    <Show when={!rr.run.live}>
                      <span class="font-mono text-[9px] text-amber-300 bg-amber-500/15 border border-amber-500/40 rounded px-1.5 py-0.5 uppercase tracking-wider">
                        paused · reload cut the turn
                      </span>
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <section>
        <h3 class="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-2">
          Agents · {rows().length}
        </h3>
        <Show
          when={rows().length > 0}
          fallback={
            <p class="text-[12px] text-gray-600 italic py-4">
              No agents on this cluster yet. Send a message in chat or run an initiative.
            </p>
          }
        >
          <ul class="space-y-1.5">
            <For each={rows()}>
              {(r) => (
                <AgentRowItem
                  row={r}
                  onOpen={() => goToChat(r.conv)}
                  onArchive={() => { void archiveConv(r.conv); }}
                />
              )}
            </For>
          </ul>
        </Show>
      </section>
    </section>
  );
}

function AgentRowItem(props: { row: AgentRow; onOpen: () => void; onArchive: () => void }) {
  const r = () => props.row;
  return (
    <li
      class={`group rounded-md border px-3 py-2 transition-colors cursor-pointer hover:bg-gray-800/40 ${
        r().runInitiativeId
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : r().status === 'streaming'
            ? 'border-amber-500/30 bg-amber-500/5'
            : 'border-gray-800/60 bg-gray-900/30'
      }`}
      onClick={props.onOpen}
    >
      <div class="flex items-center gap-2 flex-wrap">
        <span class="font-mono text-[10px] text-emerald-300 bg-emerald-500/15 border border-emerald-500/40 rounded px-1.5 py-0.5">
          {r().meta.agentId}
        </span>
        <span class="text-[12px] text-gray-100 font-medium truncate" title={r().meta.title || r().conv}>
          {r().meta.title || (r().isOnboarding ? 'Coordinator' : r().conv)}
        </span>
        <span class="font-mono text-[9px] text-gray-500 bg-gray-800/60 border border-gray-700/60 rounded px-1.5 py-0.5 uppercase tracking-wider">
          {typeBadge(r().meta.type)}
        </span>
        <Show when={r().status === 'streaming'}>
          <span class="inline-flex items-center gap-1 font-mono text-[9px] text-amber-300 bg-amber-500/15 border border-amber-500/40 rounded px-1.5 py-0.5 uppercase tracking-wider">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
            streaming
          </span>
        </Show>
        <Show when={r().runInitiativeId}>
          <span class="inline-flex items-center gap-1 font-mono text-[9px] text-emerald-300 bg-emerald-500/15 border border-emerald-500/40 rounded px-1.5 py-0.5 uppercase tracking-wider">
            in run
          </span>
        </Show>
        <span class="ml-auto text-[10px] font-mono text-gray-600">{fmtRelative(r().lastTs)}</span>
        {/* V107.9 — Inline archive button. Hidden on the Coordinator
            (onboarding conv is unarchivable by design). Visible on
            hover so the resting row stays clean. One click archives —
            restore via History → Archived filter. */}
        <Show when={!r().isOnboarding}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); props.onArchive(); }}
            title="Archive this agent (restore via History → Archived)"
            class="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-red-300 border border-transparent hover:border-red-500/40 hover:bg-red-500/5 transition-all flex-shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </Show>
      </div>
      <Show when={r().runTaskId}>
        <p class="text-[11px] text-gray-400 mt-1 truncate">
          <span class="font-mono text-[9px] text-gray-600 mr-1">task</span>
          <span class="font-mono text-emerald-300/90">{r().runTaskId}</span>
        </p>
      </Show>
      <Show when={!r().runTaskId && r().lastText}>
        <p class="text-[11px] text-gray-500 mt-1 line-clamp-1" title={r().lastText ?? ''}>
          {r().lastText}
        </p>
      </Show>
    </li>
  );
}
