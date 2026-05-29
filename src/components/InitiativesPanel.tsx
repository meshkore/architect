/**
 * InitiativesPanel — central roadmap view (M4.2 · V90 header · V92 Run all).
 *
 * Renders initiatives as cards with expand-to-task-grid layout.
 * Real-time: reads from `serverStore` memos, which refresh on
 * `state.rebuilt` / `task.updated` events wired in App.tsx, so
 * frontmatter mutations propagate without operator action.
 *
 * Header layout (left → right):
 *   INITIATIVES · [active | archived | all | backlog] · [filter…] · RUN ALL
 *
 * V92 — RUN ALL spawns a `roadmap-architect` agent (a Claude Code
 * subprocess) and dispatches a bootstrap prompt listing the visible
 * non-backlog initiatives. The agent reads the roadmap, plans
 * parallel-vs-sequential, dispatches sub-agents via /chat/dispatch,
 * and narrates progress in its own chat. No cockpit-side queue.
 */

import { For, Show, createSignal, createMemo } from 'solid-js';
import { allInitiatives, allTasks, isProjectEmpty, type ServerInitiative, type ServerTask } from '~/state/server';
import InitiativeCard from '~/components/InitiativeCard';
import EmptyOnboardingPanel from '~/components/EmptyOnboardingPanel';
import { viewStore } from '~/state/view';
import { chatStore } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { uiStore } from '~/state/ui';
import { log } from '~/lib/log';

// V90 — visibility modes replace the old visibility + status-filter
// duo. `backlog` joins the family so the operator can park ideas
// without polluting the active roadmap.
type VisibilityFilter = 'active' | 'archived' | 'all' | 'backlog';

const VISIBILITY_FILTERS: { id: VisibilityFilter; label: string; title: string }[] = [
  { id: 'active',   label: 'active',   title: 'Initiatives in flight or up next — the operative roadmap' },
  { id: 'archived', label: 'archived', title: 'Initiatives the operator manually archived' },
  { id: 'all',      label: 'all',      title: 'Everything — active, archived, completed, backlog, mixed' },
  { id: 'backlog',  label: 'backlog',  title: 'Ideas parked outside the active roadmap' },
];

export default function InitiativesPanel() {
  const [visibility, setVisibility] = createSignal<VisibilityFilter>('active');
  const [query, setQuery] = createSignal('');

  const tasksByInitiative = createMemo(() => {
    const map = new Map<string, ServerTask[]>();
    for (const t of allTasks()) {
      if (!t.initiative) continue;
      const arr = map.get(t.initiative);
      if (arr) arr.push(t); else map.set(t.initiative, [t]);
    }
    return map;
  });

  const filtered = createMemo<ServerInitiative[]>(() => {
    const q = query().trim().toLowerCase();
    const vis = visibility();
    const tbi = tasksByInitiative();
    return allInitiatives().filter((it) => {
      const arch = viewStore.isInitiativeArchived(it.id);
      const tasks = tbi.get(it.id) ?? [];
      const complete = tasks.length > 0 && tasks.every((t) => t.status === 'done');
      const isBacklog = it.status === 'backlog';
      // V90 — visibility modes:
      //   active:   not archived, not complete, not backlog
      //   archived: only the manually-archived
      //   backlog:  only `status === 'backlog'`, not archived
      //   all:      everything (mixed)
      if (vis === 'active' && (arch || complete || isBacklog)) return false;
      if (vis === 'archived' && !arch) return false;
      if (vis === 'backlog' && (arch || !isBacklog)) return false;
      if (!q) return true;
      const hay = `${it.title} ${it.id} ${it.oneliner ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  });

  // V92 — RUN ALL is coordinator-driven. The button spawns a
  // `roadmap-architect` agent (a real Claude Code subprocess via the
  // daemon's chat coordinator) with a comprehensive system prompt.
  //
  // V98 — Hardened against multi-spawn. The previous architectLive()
  // checked for streaming/pending-reply on the architect's conv, but
  // an architect that exits its first turn with empty output (silent
  // failure: bad prompt, classifier block, missing tool) cleared
  // pendingReplyConvs on `chat.assistant.final` and the button
  // flipped back to "Run all" — every subsequent click spawned
  // another architect. Now ANY non-archived roadmap-architect conv
  // counts as "the roadmap pass owner; don't spawn another".
  // Stop = cancel + archive that conv; only then does Run all spawn
  // a fresh one.
  const archCandidates = createMemo<string[]>(() => {
    return Object.entries(chatStore.state.convMeta)
      .filter(([conv, meta]) => meta.type === 'roadmap-architect' && !chatStore.state.archivedConvs[conv])
      .sort((a, b) => {
        const la = (chatStore.state.convMap[a[0]] ?? []).at(-1)?.ts ?? '';
        const lb = (chatStore.state.convMap[b[0]] ?? []).at(-1)?.ts ?? '';
        return lb.localeCompare(la);
      })
      .map(([conv]) => conv);
  });
  /** True when at least one non-archived roadmap-architect conv
   *  exists. While true, the button is in "Stop" mode — clicking
   *  cancels + archives the architect's conv so a fresh one can
   *  spawn next time. Singleton-by-construction; multi-architect
   *  was an accident waiting to happen. */
  const architectExists = () => archCandidates().length > 0;
  const activeArchConv = (): string | null => archCandidates()[0] ?? null;
  /** True only when the architect is mid-turn (streaming OR
   *  awaiting first delta). Used purely as a label hint, not for
   *  enabling/disabling the button. */
  const architectStreaming = () => {
    const conv = activeArchConv();
    if (!conv) return false;
    const list = chatStore.state.convMap[conv] ?? [];
    if (list.some((m) => m.kind === 'assistant' && m.streaming)) return true;
    return chatStore.state.pendingReplyConvs[conv] !== undefined;
  };

  const onRunAll = async (): Promise<void> => {
    const client = daemonStore.state.client;
    if (!client) return;
    // STOP path — an architect exists (regardless of whether it is
    // currently streaming). Cancel its in-flight turn (no-op if
    // already idle) then archive the conv so a fresh Run all spawns
    // a new architect with no prior context.
    if (architectExists()) {
      const conv = activeArchConv();
      if (!conv) return;
      try {
        const res = await client.chatCancel(conv);
        if (!res.ok) log.warn('roadmap-architect cancel non-OK', res.status);
      } catch (e) {
        log.warn('roadmap-architect cancel threw', e instanceof Error ? e.message : String(e));
      }
      chatStore.archiveConv(conv);
      return;
    }
    // SPAWN path — no architect exists. Build the visible-initiative
    // summary (the architect reads the actual files itself).
    const list = filtered()
      .filter((it) => {
        if (viewStore.isInitiativeArchived(it.id)) return false;
        if (it.status === 'backlog') return false;
        const tasks = tasksByInitiative().get(it.id) ?? [];
        if (tasks.length === 0) return false;
        return tasks.some((t) => t.status !== 'done' && t.status !== 'cancelled');
      });
    if (list.length === 0) return;
    const conv = chatStore.createConv({
      type: 'roadmap-architect',
      title: 'Roadmap Architect',
      model: 'auto',
    });
    uiStore.setActiveZone('architect');
    const bootstrap = [
      `Run all — kick off a roadmap execution pass.`,
      ``,
      `Active scope (${list.length} initiative${list.length === 1 ? '' : 's'}, in order):`,
      ...list.map((it, i) => `${i + 1}. ${it.id} — ${it.title}`),
      ``,
      `Follow your standing operating procedure:`,
      `1. Read .meshkore/roadmap/initiatives/ + linked tasks.`,
      `2. Plan parallel-vs-sequential for the first initiative.`,
      `3. Dispatch sub-agents and report each move in this chat.`,
      `4. Continue until all initiatives ship OR you hit a blocker; then stop and tell me what you need.`,
      ``,
      `Start now. First message should be: which initiative are you taking, what tasks it has, and which sub-agents you're about to launch.`,
    ].join('\n');
    const res = await chatStore.dispatchMessage(client, {
      conv,
      text: bootstrap,
      author: 'architect',
    });
    if (!res.ok) {
      log.error('roadmap-architect bootstrap failed', res.status, res.error);
    }
  };

  return (
    <section class="min-w-0 p-4">
      <Show when={!isProjectEmpty()} fallback={<EmptyOnboardingPanel />}>
        <header class="flex flex-wrap items-center gap-2 mb-4">
          <h2 class="text-sm font-mono uppercase tracking-wider text-gray-500">Initiatives</h2>
          {/* V90 — visibility modes (active · archived · all · backlog) */}
          <div class="flex items-center gap-1">
            <For each={VISIBILITY_FILTERS}>
              {(f) => (
                <button
                  type="button"
                  onClick={() => setVisibility(f.id)}
                  class={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors ${
                    visibility() === f.id
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                      : 'text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                  title={f.title}
                >
                  {f.label}
                </button>
              )}
            </For>
          </div>
          <input
            type="text"
            placeholder="Filter…"
            value={query()}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            class="bg-gray-900/60 border border-gray-800 rounded-md px-3 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 w-44"
          />
          <div class="ml-auto flex items-center">
            <button
              type="button"
              onClick={() => { void onRunAll(); }}
              disabled={!architectExists() && filtered().length === 0}
              title={
                architectExists()
                  ? (architectStreaming()
                      ? 'Stop the running Roadmap Architect and archive its conv (Run all spawns fresh next time)'
                      : 'An architect conv already exists — click to cancel + archive it so Run all can spawn a fresh one')
                  : 'Spawn a Roadmap Architect agent to plan + dispatch the visible roadmap'
              }
              class={`px-3 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-wider transition-colors border disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 ${
                architectExists()
                  ? 'bg-red-500/15 hover:bg-red-500/30 text-red-300 border-red-500/40'
                  : 'bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-300 border-cyan-500/40'
              }`}
            >
              <Show when={architectExists()} fallback={
                <span class="inline-flex items-center gap-1.5">
                  <span aria-hidden="true">🗺️</span>
                  <span>Run all</span>
                </span>
              }>
                <span
                  class={`inline-block w-1.5 h-1.5 rounded-full bg-red-400 ${architectStreaming() ? 'animate-pulse' : ''}`}
                  aria-hidden="true"
                />
                <span>Stop architect</span>
              </Show>
            </button>
          </div>
        </header>

        <Show when={filtered().length > 0} fallback={<NoMatch totalInitiatives={allInitiatives().length} />}>
          <ul class="space-y-4">
            <For each={filtered()}>
              {(it) => (
                <li>
                  <InitiativeCard
                    initiative={it}
                    tasks={tasksByInitiative().get(it.id) ?? []}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>

        <p class="text-xs text-gray-600 mt-6">
          {filtered().length} of {allInitiatives().length} initiatives · {allTasks().length} tasks · live from daemon
        </p>
      </Show>
    </section>
  );
}

function NoMatch(props: { totalInitiatives: number }) {
  return (
    <div class="text-center py-16 text-gray-500">
      <p class="text-sm">
        {props.totalInitiatives === 0
          ? 'No initiatives loaded yet.'
          : 'No initiatives match this filter.'}
      </p>
    </div>
  );
}
