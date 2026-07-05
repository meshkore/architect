/**
 * AgentsPanel — the Team zone (ATM3).
 *
 * Rescoped 2026-07-03 from "who is working on what" into the TEAM
 * ROSTER manager. Three stacked parts:
 *
 *  1. Roster (top) — a card grid of team members from `GET /team`
 *     (teamStore). Create (ATM4 dialog) / edit (ATM6 detail panel) /
 *     delete, with live instance counts and required/kind badges.
 *
 *  2. Active runs (only when any are in flight) — every active story
 *     run with progress + stop, unchanged from the pre-rescope panel.
 *
 *  3. Instances (always) — every non-archived conv, grouped under its
 *     bound member when `conv_meta.member` is present (ATM10).
 *
 * Parts 2–3 read from chatStore / storyStore; part 1 reads teamStore.
 */

import { For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { chatStore, ONBOARDING_CONV_ID } from '~/state/chat';
import type { ChatConvSummary, TeamMember } from '~/lib/daemon-client';
import { storyStore } from '~/state/story';
import { daemonStore } from '~/state/daemon';
import { teamStore } from '~/state/team';
import { allTasks, allInitiatives } from '~/state/server';
import { uiStore } from '~/state/ui';
import { modelLabel } from '~/lib/models';
import { log } from '~/lib/log';
import NewMemberDialog from '~/components/team/NewMemberDialog';
import MemberDetailPanel from '~/components/team/MemberDetailPanel';

interface AgentRow {
  conv: string;
  summary: ChatConvSummary;
  status: 'idle' | 'streaming';
  runInitiativeId: string | null;
  runTaskId: string | null;
  isOnboarding: boolean;
  member: string | null;
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

function typeBadge(t: string | null | undefined): string {
  if (!t || t === 'custom') return 'agent';
  return t;
}

/** First paragraph of the init prompt, trimmed to ~120 chars — the
 *  card's one-line mission (ATM3). Strips a leading `# Heading`. */
function missionLine(body: string | null | undefined): string {
  if (!body) return '';
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#{1,6}\s/.test(p) && !/^(##\s*Mission)/i.test(p));
  const first = paras[0] ?? '';
  const flat = first.replace(/\s+/g, ' ').replace(/^#{1,6}\s+/, '');
  return flat.length > 120 ? flat.slice(0, 117) + '…' : flat;
}

export default function AgentsPanel() {
  const [newMemberOpen, setNewMemberOpen] = createSignal(false);
  const [detailId, setDetailId] = createSignal<string | null>(null);

  const activeRuns = createMemo(() => storyStore.state.runs.filter(
    (r) => r.status !== 'done' && r.status !== 'cancelled' && r.status !== 'failed',
  ));

  const rows = createMemo<AgentRow[]>(() => {
    const out: AgentRow[] = [];
    const runsByConv = new Map(activeRuns().map((r) => [r.conv, r]));
    for (const summary of Object.values(chatStore.state.convs)) {
      if (summary.archived) continue;
      const run = runsByConv.get(summary.conv) ?? null;
      out.push({
        conv: summary.conv,
        summary,
        status: summary.live ? 'streaming' : 'idle',
        runInitiativeId: run?.initiativeId ?? null,
        runTaskId: run ? (run.taskIds[run.cursor] ?? null) : null,
        isOnboarding: summary.conv === ONBOARDING_CONV_ID,
        member: chatStore.state.convMeta[summary.conv]?.member ?? null,
      });
    }
    out.sort((a, b) => {
      const aRun = a.runInitiativeId ? 1 : 0;
      const bRun = b.runInitiativeId ? 1 : 0;
      if (aRun !== bRun) return bRun - aRun;
      const aStream = a.status === 'streaming' ? 1 : 0;
      const bStream = b.status === 'streaming' ? 1 : 0;
      if (aStream !== bStream) return bStream - aStream;
      const aTs = a.summary.last_activity_at ? Date.parse(a.summary.last_activity_at) : 0;
      const bTs = b.summary.last_activity_at ? Date.parse(b.summary.last_activity_at) : 0;
      return bTs - aTs;
    });
    return out;
  });

  // ATM10 — group instance rows under their bound member. Rows with no
  // member (legacy convs, onboarding) fall into an "Unassigned" bucket.
  const grouped = createMemo(() => {
    const byMember = new Map<string | null, AgentRow[]>();
    for (const r of rows()) {
      const key = r.member;
      const arr = byMember.get(key) ?? [];
      arr.push(r);
      byMember.set(key, arr);
    }
    const order: Array<{ member: TeamMember | null; key: string | null; rows: AgentRow[] }> = [];
    for (const m of teamStore.state.list) {
      const rs = byMember.get(m.id);
      if (rs && rs.length) { order.push({ member: m, key: m.id, rows: rs }); byMember.delete(m.id); }
    }
    // Any member ids not in the roster (renamed/removed) + unassigned.
    for (const [key, rs] of byMember.entries()) {
      order.push({ member: null, key, rows: rs });
    }
    return order;
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

  const archiveConv = async (conv: string): Promise<void> => {
    chatStore.archiveConv(conv);
    if (chatStore.state.activeConv === conv) chatStore.setActiveConv(null);
    const client = daemonStore.state.client;
    if (!client) return;
    const res = await client.chatArchive(conv);
    if (!res.ok) log.warn('[agents-panel:archive] sync to daemon failed', res.status);
  };

  return (
    <section class="zone-host p-4 overflow-y-auto">
      {/* Roster toolbar */}
      <header class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-mono uppercase tracking-wider text-gray-400">Team</h2>
          <p class="text-[11px] text-gray-600 mt-0.5">
            The members that make up this cluster's team. Create, edit and
            see live instances of each.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewMemberOpen(true)}
          class="flex-shrink-0 text-[12px] font-mono text-emerald-300 hover:text-emerald-200 border border-emerald-500/40 hover:border-emerald-500/70 bg-emerald-500/5 rounded px-3 py-1.5 transition-colors"
        >+ New member</button>
      </header>

      {/* Roster grid */}
      <Show
        when={teamStore.state.list.length > 0}
        fallback={
          <p class="text-[12px] text-gray-600 italic py-4 mb-6">
            <Show when={teamStore.state.loading} fallback="No team members yet. Click “+ New member” to add one.">
              Loading team…
            </Show>
          </p>
        }
      >
        <div class="grid gap-3 mb-8" style={{ 'grid-template-columns': 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          <For each={teamStore.state.list}>
            {(m) => (
              <MemberCard
                member={m}
                highlight={teamStore.state.recentlyCreated === m.id}
                onOpen={() => setDetailId(m.id)}
                onDelete={() => setDetailId(m.id)}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Active runs */}
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

      {/* Instances, grouped by member */}
      <section>
        <h3 class="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-2">
          Instances · {rows().length}
        </h3>
        <Show
          when={rows().length > 0}
          fallback={
            <p class="text-[12px] text-gray-600 italic py-4">
              No live instances. Click + in the chat rail or run an initiative.
            </p>
          }
        >
          <div class="space-y-4">
            <For each={grouped()}>
              {(grp) => (
                <div>
                  <div class="flex items-center gap-1.5 mb-1.5">
                    <span class="text-[13px]" aria-hidden="true">{grp.member?.emoji ?? '•'}</span>
                    <span class="text-[11px] font-medium text-gray-400">
                      {grp.member?.name ?? (grp.key ?? 'Unassigned')}
                    </span>
                    <span class="text-[10px] font-mono text-gray-600">· {grp.rows.length}</span>
                  </div>
                  <ul class="space-y-1.5">
                    <For each={grp.rows}>
                      {(r) => (
                        <AgentRowItem
                          row={r}
                          onOpen={() => goToChat(r.conv)}
                          onArchive={() => { void archiveConv(r.conv); }}
                        />
                      )}
                    </For>
                  </ul>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      {/* Dialogs */}
      <Show when={newMemberOpen()}>
        <NewMemberDialog onClose={() => setNewMemberOpen(false)} />
      </Show>
      <Show when={detailId()}>
        <MemberDetailPanel
          memberId={detailId()!}
          onClose={() => setDetailId(null)}
          onDeleted={() => setDetailId(null)}
        />
      </Show>
    </section>
  );
}

function MemberCard(props: {
  member: TeamMember;
  highlight: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const m = () => props.member;
  const client = () => daemonStore.state.client;
  // Lazy-load the body for the one-line mission (roster is small).
  const [body] = createResource(
    () => props.member.id,
    async (id) => {
      const c = client();
      if (!c) return '';
      const d = await teamStore.detail(c, id);
      return d?.body ?? '';
    },
  );
  const color = () => m().color || '#34d399';

  return (
    <div
      class="group relative rounded-lg border bg-gray-900/40 hover:bg-gray-800/50 px-3 py-3 cursor-pointer transition-colors"
      classList={{
        'border-emerald-500/60 ring-1 ring-emerald-500/40': props.highlight,
        'border-gray-800/60': !props.highlight,
      }}
      onClick={props.onOpen}
    >
      <div class="flex items-start gap-2.5">
        <span
          class="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-xl"
          style={{ background: `${color()}1a`, border: `1px solid ${color()}55` }}
          aria-hidden="true"
        >{m().emoji || '🤖'}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-[13px] font-semibold text-gray-100 truncate">{m().name}</span>
            <Show when={m().required}>
              <span title="Required member — cannot be deleted" class="text-amber-300 text-[11px]">🔒</span>
            </Show>
          </div>
          <div class="flex flex-wrap items-center gap-1 mt-1">
            <span class="font-mono text-[9px] text-purple-200 bg-purple-500/10 border border-purple-500/30 rounded px-1.5 py-0.5">
              {modelLabel(m().model)}
            </span>
            <span class="font-mono text-[9px] uppercase tracking-wider text-gray-400 bg-gray-800/60 border border-gray-700/60 rounded px-1.5 py-0.5">
              {m().kind}
            </span>
            {/* TEG-3 — externally exposed member (token-reachable by other
                local software). Pulses briefly on team.request.* activity. */}
            <Show when={m().exposure === 'external'}>
              <span
                class="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-sky-200 bg-sky-500/10 border border-sky-500/30 rounded px-1.5 py-0.5"
                title="Externally exposed — other software on this machine can query this member with its token"
              >
                ↗ external
                <Show when={teamStore.state.requestPulse[m().id]}>
                  <span class="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" aria-hidden="true" />
                </Show>
              </span>
            </Show>
            <span
              class="font-mono text-[9px] rounded px-1.5 py-0.5 border"
              classList={{
                'text-emerald-300 bg-emerald-500/15 border-emerald-500/40': (m().instances ?? 0) > 0,
                'text-gray-500 bg-gray-800/40 border-gray-700/50': (m().instances ?? 0) === 0,
              }}
              title="Live non-archived instances"
            >{m().instances ?? 0} live</span>
          </div>
        </div>
      </div>
      <p class="text-[11px] text-gray-500 mt-2 leading-snug min-h-[2.4em]">
        {body.loading ? '' : (missionLine(body()) || 'No mission set.')}
      </p>
      {/* Delete (hidden when required) */}
      <Show when={!m().required}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); props.onDelete(); }}
          title="Manage / delete this member"
          class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-red-300 border border-transparent hover:border-red-500/40 hover:bg-red-500/5 transition-all"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          </svg>
        </button>
      </Show>
    </div>
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
          {r().summary.agent_id ?? '—'}
        </span>
        <span class="text-[12px] text-gray-100 font-medium truncate" title={r().conv}>
          {r().isOnboarding ? 'Architect Agent' : r().conv}
        </span>
        <span class="font-mono text-[9px] text-gray-500 bg-gray-800/60 border border-gray-700/60 rounded px-1.5 py-0.5 uppercase tracking-wider">
          {typeBadge(r().summary.agent_type)}
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
        <span class="ml-auto text-[10px] font-mono text-gray-600">{fmtRelative(r().summary.last_activity_at)}</span>
        <Show when={!r().isOnboarding}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); props.onArchive(); }}
            title="Archive this instance (restore via History → Archived)"
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
      <Show when={!r().runTaskId && r().summary.task_id}>
        <p class="text-[11px] text-gray-500 mt-1 truncate">
          <span class="font-mono text-[9px] text-gray-600 mr-1">task</span>
          <span class="font-mono text-emerald-300/90">{r().summary.task_id}</span>
        </p>
      </Show>
    </li>
  );
}
