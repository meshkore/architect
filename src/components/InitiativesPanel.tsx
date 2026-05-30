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

import { For, Show, createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import { allInitiatives, allTasks, isProjectEmpty, type ServerInitiative, type ServerTask } from '~/state/server';
import InitiativeCard from '~/components/InitiativeCard';
import EmptyOnboardingPanel from '~/components/EmptyOnboardingPanel';
import { viewStore } from '~/state/view';
import { chatStore } from '~/state/chat';
import { storyStore } from '~/state/story';
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
  // V106.3 — Initiatives currently animating their exit from the
  // active list. Triggered when all tasks of an initiative flip to
  // status=done while the operator is on the active filter. The id
  // stays in this set for ~550ms (the CSS transition), then we flip
  // viewStore.archived=true and remove from the set, so the card
  // gracefully fades + collapses before disappearing.
  const [exiting, setExiting] = createSignal<Set<string>>(new Set());
  const EXIT_ANIM_MS = 550;

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
    const exitingSet = exiting();
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
      // V106.3 — During the exit animation, keep the card visible
      // in the active filter even though it's complete, so the
      // operator sees it gracefully fade + collapse.
      if (vis === 'active') {
        if (exitingSet.has(it.id)) {
          // Still animating out — leave it visible.
        } else if (arch || complete || isBacklog) {
          return false;
        }
      }
      if (vis === 'archived' && !arch) return false;
      if (vis === 'backlog' && (arch || !isBacklog)) return false;
      if (!q) return true;
      const hay = `${it.title} ${it.id} ${it.oneliner ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  });

  // V106.3 — Auto-archive freshly-completed initiatives. When the
  // final task of an active, non-archived initiative flips to
  // status=done, kick off the exit animation (CSS-driven via the
  // `exiting` flag passed to InitiativeCard), then mark it archived
  // after the transition. The animation only fires while the
  // operator is on the `active` filter — on `all`/`archived` the
  // card stays put.
  const pendingTimers = new Map<string, number>();
  /** Re-check completion at timer fire-time — guards against the
   *  brief race where an operator (or a sub-agent) flips a task
   *  status back during the 30ms scheduling delay. */
  const isStillCompleteAndUnarchived = (id: string): boolean => {
    if (viewStore.isInitiativeArchived(id)) return false;
    const tasks = tasksByInitiative().get(id) ?? [];
    if (tasks.length === 0) return false;
    return tasks.every((t) => t.status === 'done');
  };
  createEffect(() => {
    const tbi = tasksByInitiative();
    const exitingSet = exiting();
    for (const it of allInitiatives()) {
      if (viewStore.isInitiativeArchived(it.id)) continue;
      const tasks = tbi.get(it.id) ?? [];
      if (tasks.length === 0) continue;
      const complete = tasks.every((t) => t.status === 'done');
      if (!complete) continue;
      if (exitingSet.has(it.id)) continue;
      if (pendingTimers.has(it.id)) continue;
      // Start exit animation on the next microtask so the DOM is
      // already laid out with full height before max-height -> 0.
      const id = it.id;
      const t = window.setTimeout(() => {
        // Race guard: a task could have flipped back to in-progress
        // (operator edit, sub-agent rollback) during the 30ms delay.
        if (!isStillCompleteAndUnarchived(id)) {
          pendingTimers.delete(id);
          return;
        }
        setExiting((s) => { const n = new Set(s); n.add(id); return n; });
        const t2 = window.setTimeout(() => {
          // Last guard before we flip the archived bit — same reason.
          if (isStillCompleteAndUnarchived(id)) {
            viewStore.setInitiativeArchived(id, true);
          }
          setExiting((s) => { const n = new Set(s); n.delete(id); return n; });
          pendingTimers.delete(id);
        }, EXIT_ANIM_MS);
        pendingTimers.set(id, t2);
      }, 30);
      pendingTimers.set(id, t);
    }
  });
  onCleanup(() => {
    for (const t of pendingTimers.values()) clearTimeout(t);
    pendingTimers.clear();
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
    // V99 — Detect via TWO predicates so we don't miss convs whose
    // type field is stale from a pre-V92 bundle (the type union
    // hadn't been extended; ensureConvMeta may have fallen back to
    // 'custom'). Slug prefix `roadmap-architect-…` is the
    // unforgeable signal because createConv emits exactly that
    // shape for this type. Either predicate hitting counts as
    // "this is an architect conv".
    return Object.entries(chatStore.state.convMeta)
      .filter(([conv, meta]) => {
        if (chatStore.state.archivedConvs[conv]) return false;
        if (meta.type === 'roadmap-architect') return true;
        if (conv.startsWith('roadmap-architect-')) return true;
        return false;
      })
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

  /** V106 — Any per-initiative story-run currently in flight on
   *  the cluster. Used to MUTUAL-EXCLUDE Run all: while a single
   *  initiative is running, spawning the roadmap architect would
   *  fight over the same files. Operator's spec:
   *  "si alguna iniciativa se está ejecutando, el botón Run all
   *   debería estar apagado." */
  const anyStoryRunLive = createMemo(() =>
    storyStore.state.runs.some((r) =>
      (r.status === 'running' || r.status === 'stopping') && r.live,
    ),
  );
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
    if (!client) {
      log.warn('[run-all] no daemon client — abort');
      return;
    }
    // V106.1 — STOP path. The original V100 spec said "Stop ≠ archive"
    // (the conv stays as a permanent record). That created a deadlock:
    // after the architect finished a turn (status=idle), the conv was
    // still alive → architectExists() stayed true → per-initiative
    // plays stayed disabled forever, and clicking "Stop architect"
    // again did nothing visible (cancel on an idle conv is a no-op).
    //
    // V106.1 reverses it: Stop = cancel in-flight stream + archive
    // the conv (both locally AND daemon-side). Archived convs still
    // exist and are reachable via the "Archived" history filter, so
    // we preserve the "permanent record" intent without leaving the
    // system in a half-locked state.
    if (architectExists()) {
      const conv = activeArchConv();
      if (!conv) {
        log.warn('[stop-architect] architectExists() true but activeArchConv() is null — state mismatch');
        return;
      }
      log.info('[stop-architect] start', { conv, streaming: architectStreaming() });
      // 1. Cancel any in-flight chat turn (no-op if already idle).
      try {
        const res = await client.chatCancel(conv);
        log.info('[stop-architect] /chat/cancel', { ok: res.ok, status: res.status });
        if (!res.ok) log.warn('[stop-architect] cancel non-OK', res.status);
      } catch (e) {
        log.warn('[stop-architect] cancel threw', e instanceof Error ? e.message : String(e));
      }
      // 2. Archive the conv on the daemon (authoritative).
      try {
        const res = await client.chatArchive(conv);
        log.info('[stop-architect] /chat/archive', { ok: res.ok, status: res.status });
        if (!res.ok) log.warn('[stop-architect] archive non-OK', res.status);
      } catch (e) {
        log.warn('[stop-architect] archive threw', e instanceof Error ? e.message : String(e));
      }
      // 3. Archive locally so the UI flips immediately (don't wait
      //    for the WS broadcast to round-trip).
      chatStore.archiveConv(conv);
      log.info('[stop-architect] local archiveConv done', { conv, archivedNow: chatStore.state.archivedConvs[conv] === true });
      // 4. Surface a non-architect conv so the operator isn't left
      //    staring at the (now archived) architect chat.
      const remaining = Object.keys(chatStore.state.convMeta).find(
        (c) => !chatStore.state.archivedConvs[c] && c !== conv,
      );
      if (remaining) chatStore.setActiveConv(remaining);
      log.info('[stop-architect] done — architectExists now?', architectExists());
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
    // V107.3 — Bootstrap rewritten. The V92 bootstrap said
    // "Continue until you ship OR hit a blocker; then stop and tell
    // me what you need" — that user-turn instruction OVERRODE the
    // daemon's py-1.10.x system SOP (which says: never halt, use
    // catalog → stub-flag → matrix → consult-A001). Operator observed
    // the architect literally quoting "stop on the first blocker per
    // SOP" from this bootstrap. Removed every contradicting line.
    // The bootstrap now JUST kicks off the daemon's SOP — no
    // procedure, no stop conditions, just scope + go.
    const bootstrap = [
      `Run all.`,
      ``,
      `Active scope (${list.length} initiative${list.length === 1 ? '' : 's'}, lower-id first):`,
      ...list.map((it, i) => `${i + 1}. ${it.id} — ${it.title}`),
      ``,
      `Follow your SOP exactly. The chain on every blocker: DECISION CATALOG → STUB-AND-FLAG → DECISION MATRIX → CONSULT-A001. Never halt mid-pass. The single voluntary halt is the end-of-pass 4-bucket summary.`,
      ``,
      `Start now. Your very first line MUST be \`═══ VALIDATION GREEN ═══\` or \`═══ VALIDATION RED ═══\`. Be terse.`,
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
              disabled={
                !architectExists() && (
                  filtered().length === 0 ||
                  anyStoryRunLive()
                )
              }
              title={
                architectExists()
                  ? (architectStreaming()
                      ? 'Stop the running Roadmap Architect and archive its conv (Run all spawns fresh next time)'
                      : 'An architect conv already exists — click to cancel + archive it so Run all can spawn a fresh one')
                  : anyStoryRunLive()
                    ? 'Hay otras iniciativas en marcha en este momento. No se puede ejecutar Run all a la vez — paráalas primero desde cada card.'
                    : filtered().length === 0
                      ? 'No hay iniciativas elegibles para Run all'
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
              {(it) => {
                const isExiting = () => exiting().has(it.id);
                return (
                  <li
                    class="overflow-hidden transition-all ease-in-out"
                    style={{
                      'transition-duration': `${EXIT_ANIM_MS}ms`,
                      'max-height': isExiting() ? '0px' : '4000px',
                      opacity: isExiting() ? '0' : '1',
                      transform: isExiting() ? 'scale(0.96)' : 'scale(1)',
                      'margin-top': isExiting() ? '-1rem' : undefined,
                    }}
                  >
                    <InitiativeCard
                      initiative={it}
                      tasks={tasksByInitiative().get(it.id) ?? []}
                    />
                  </li>
                );
              }}
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
