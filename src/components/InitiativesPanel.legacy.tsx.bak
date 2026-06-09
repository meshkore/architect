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
import { daemonStore, daemonHealth } from '~/state/daemon';
import { runArchitectOnScope, stopArchitect } from '~/lib/architect-dispatch';
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
    // py-1.10.15 — When `vis === 'archived'`, the source of truth for
    // "this initiative is closed" is now the daemon (`status: done`
    // + `completed_at` written by the auto-archive reconcile pass —
    // initiative `roadmap-ordering-archive`, task D-RM-ARCHIVE-02).
    // We keep `viewStore.isInitiativeArchived` as a back-compat
    // shadow for operator-driven manual archives.
    const list = allInitiatives().filter((it) => {
      const isDone = it.status === 'done';
      // V107.29 — Daemon is authoritative for `active`. If the daemon
      // says `status: active`, the operator-shadow archive flag is
      // suppressed. Closes a race observed 2026-06-02 (ikamiro): the
      // V106.3 auto-archive saw a transient `tasks.every(done)` window
      // during a daemon state-rebuild and marked 5 actives as
      // archived in localStorage; daemon then caught up with the
      // correct in-progress tasks, but the local shadow stayed pegged,
      // hiding the 5 from the ACTIVE filter even though the daemon
      // reported them active.
      const isArchManual = viewStore.isInitiativeArchived(it.id) && it.status !== 'active';
      const isArchived = isDone || isArchManual;
      const tasks = tbi.get(it.id) ?? [];
      const complete = tasks.length > 0 && tasks.every((t) => t.status === 'done');
      const isBacklog = it.status === 'backlog';
      // V90 — visibility modes:
      //   active:   not archived, not complete, not backlog
      //   archived: only the manually-archived OR `status: done`
      //   backlog:  only `status === 'backlog'`, not archived
      //   all:      everything (mixed)
      // V106.3 — During the exit animation, keep the card visible
      // in the active filter even though it's complete, so the
      // operator sees it gracefully fade + collapse.
      if (vis === 'active') {
        if (exitingSet.has(it.id)) {
          // Still animating out — leave it visible.
        } else if (isArchived || complete || isBacklog) {
          return false;
        }
      }
      if (vis === 'archived' && !isArchived) return false;
      if (vis === 'backlog' && (isArchManual || !isBacklog)) return false;
      if (!q) return true;
      const hay = `${it.title} ${it.id} ${it.oneliner ?? ''}`.toLowerCase();
      return hay.includes(q);
    });

    // py-1.10.15 — Archived view sorts chronologically (newest first)
    // by `completed_at`. The daemon already orders the active view
    // via the linked-list walk; archived gets its own dimension.
    if (vis === 'archived') {
      return list.slice().sort((a, b) => {
        const ca = String(a.completed_at ?? '');
        const cb = String(b.completed_at ?? '');
        // Missing completed_at → sink to bottom (older manual archives).
        if (!ca && !cb) return 0;
        if (!ca) return 1;
        if (!cb) return -1;
        return cb.localeCompare(ca);
      });
    }
    return list;
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

  // V107.29 — Auto-cleanup stale archive shadows. Runs whenever
  // allInitiatives() changes (i.e., every state refresh). If the
  // daemon now reports `status: active` for an initiative whose
  // local shadow still says archived, drop the shadow. The filter
  // already ignores stale shadows visually (see filter() above), but
  // this clears the persisted localStorage entry so we don't keep a
  // permanent lie sitting around for the next session to inherit.
  // Closes the cavioca/ikamiro 2026-06-02 race where a transient
  // tasks.every(done) window auto-archived 5 active initiatives.
  createEffect(() => {
    for (const it of allInitiatives()) {
      if (it.status === 'active' && viewStore.isInitiativeArchived(it.id)) {
        viewStore.setInitiativeArchived(it.id, false);
      }
    }
  });
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
    // py-1.11.2-cockpit — Source of truth is `chatStore.state.convs`
    // (daemon-authoritative since Phase 2). Reading from convMeta was
    // the bug: it's a local cache that survives a cluster swap + can
    // keep entries for convs the daemon has since archived. After my
    // cleanup of ikamiro, the rail correctly showed only Master but
    // STOP ARCHITECT still appeared because convMeta still held the
    // archived roadmap-architect entry.
    //
    // Detection uses two predicates so we catch convs whose stored
    // agent_type drifted ('custom' for some legacy entries) — the
    // slug `roadmap-architect-*` is the unforgeable shape createConv
    // emits for this role.
    return Object.values(chatStore.state.convs)
      .filter((c) => {
        if (c.archived) return false;
        if (c.agent_type === 'roadmap-architect') return true;
        if (c.conv.startsWith('roadmap-architect-')) return true;
        return false;
      })
      .sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''))
      .map((c) => c.conv);
  });
  /** True when at least one non-archived roadmap-architect conv
   *  exists. Used to decide WHICH conv to reuse on Run All. */
  const architectExists = () => archCandidates().length > 0;
  const activeArchConv = (): string | null => archCandidates()[0] ?? null;

  /** py-1.11.2-cockpit — True only when the architect conv is LIVE
   *  (own runner streaming OR coordinating subagents). Drives the
   *  STOP button — idle architect convs (carrying past-pass summaries)
   *  no longer trigger STOP, the operator gets "Run all" so they can
   *  resume / continue. */
  const architectLive = createMemo<boolean>(() => {
    const conv = activeArchConv();
    if (!conv) return false;
    const s = chatStore.state.convs[conv];
    return !!s && (s.live || s.coordinating);
  });

  /** py-1.11.2-cockpit — "Is any other activity in flight in this
   *  cluster that ISN'T the roadmap architect itself?" Single source
   *  of truth: `chatStore.state.convs` (daemon-authoritative). Covers
   *  per-initiative story runs AND any subagent dispatched by the
   *  architect AND manual chat turns. The architect's own conv is
   *  excluded because its live state is what `architectLive` itself
   *  reports — disabling Run All on the architect being live would be
   *  redundant with the STOP/RUN toggle.
   *
   *  Spec 2026-05-31: "si hay otra historia en marcha, el botón Run
   *  all debería estar apagado". Same rule applied symmetrically to
   *  the per-initiative play buttons via `otherActivityLive` in
   *  InitiativeCard. */
  const anyStoryRunLive = createMemo<boolean>(() => {
    const archConv = activeArchConv();
    for (const c of Object.values(chatStore.state.convs)) {
      if (!c.live && !c.coordinating) continue;
      if (c.conv === archConv) continue; // the architect itself
      return true;
    }
    return false;
  });
  // V107.14 — The Run All feature-gate moved to the canonical
  // `daemonStore.state.outdated` signal (extended in lib/version.ts
  // via REQUIRED_DAEMON_FEATURES). When features are missing, the
  // cockpit replaces this panel's container with the full-area
  // DaemonOutdatedPanel, so by the time InitiativesPanel renders the
  // daemon is guaranteed to satisfy the gate. The old local
  // REQUIRED_FEATURES + missingFeatures + DaemonOutdatedBanner were
  // a parallel UX path that confused operators; deleted here in
  // favour of the single Outdated-Panel + AutoUpdateFlow contract.

  // py-1.11.2-cockpit — `architectStreaming` deleted. Was used as a
  // label hint on the STOP button; that role is now covered by the
  // `animate-pulse` red dot on the button itself (which only renders
  // when `architectLive()` is true).

  /** py-1.12.0-cockpit — Run All delegates to the shared
   *  `runArchitectOnScope`. Same function the per-initiative ▶ calls
   *  with mode='single', ensuring there is ONE code path that drives
   *  the architect (rail state, conv reuse, bootstrap, debug stream,
   *  spinner derivation). Stop = same `stopArchitect()` everywhere. */
  const onRunAll = async (): Promise<void> => {
    if (architectLive()) {
      await stopArchitect();
      return;
    }
    const list = filtered().filter((it) => {
      if (viewStore.isInitiativeArchived(it.id)) return false;
      if (it.status === 'backlog') return false;
      const tasks = tasksByInitiative().get(it.id) ?? [];
      if (tasks.length === 0) return false;
      return tasks.some((t) => t.status !== 'done' && t.status !== 'cancelled');
    });
    await runArchitectOnScope({ mode: 'all', list });
  };

  return (
    <section class="initiatives-section min-w-0 p-4">
      <Show when={!isProjectEmpty()} fallback={<EmptyOnboardingPanel />}>
        <header class="initiatives-header flex flex-nowrap items-center gap-2 mb-4 min-w-0">
          <h2 class="initiatives-title text-sm font-mono uppercase tracking-wider text-gray-500 flex-shrink-0">Initiatives</h2>
          {/* V90 — visibility modes (active · archived · all · backlog) */}
          <div class="initiatives-filters flex items-center gap-1 flex-shrink-0">
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
            class="initiatives-filter-input bg-gray-900/60 border border-gray-800 rounded-md px-3 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 w-44 min-w-0"
          />
          <div class="ml-auto flex items-center flex-shrink-0">
            <button
              type="button"
              onClick={() => { void onRunAll(); }}
              disabled={
                !architectLive() && (
                  filtered().length === 0 ||
                  anyStoryRunLive()
                )
              }
              title={
                architectLive()
                  ? 'Stop the running Roadmap Architect (cancel the in-flight turn; the conv stays so you can read the summary)'
                  : anyStoryRunLive()
                    ? 'Hay otras iniciativas en marcha. Páralas primero desde cada card.'
                    : filtered().length === 0
                      ? 'No hay iniciativas elegibles para Run all'
                      : architectExists()
                        ? 'Resume the existing Roadmap Architect with a new turn over the visible scope'
                        : 'Spawn a Roadmap Architect agent to plan + dispatch the visible roadmap'
              }
              class={`px-3 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-wider transition-colors border disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 ${
                architectLive()
                  ? 'bg-red-500/15 hover:bg-red-500/30 text-red-300 border-red-500/40'
                  : 'bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-300 border-cyan-500/40'
              }`}
            >
              <Show when={architectLive()} fallback={
                <span class="inline-flex items-center gap-1.5">
                  <span aria-hidden="true">🗺️</span>
                  <span class="runall-label-full">Run all</span>
                  <span class="runall-label-short" aria-hidden="true">Run</span>
                </span>
              }>
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" aria-hidden="true" />
                <span class="runall-label-full">Stop architect</span>
                <span class="runall-label-short" aria-hidden="true">Stop</span>
              </Show>
            </button>
          </div>
        </header>

        {/* V107.14 — Inline DaemonOutdatedBanner removed. The canonical
            full-area DaemonOutdatedPanel (Cockpit.tsx, gated by
            daemonStore.state.outdated which now covers BOTH version
            and feature gaps) is the single recovery surface. By the
            time InitiativesPanel renders, the daemon is guaranteed to
            satisfy the gate. */}
        {/* py-1.10.26 — Rate-limit banner. Surfaces when any
            agent_type is currently paused (auto from rate-limit
            detection or manual via /agent-types/<t>/pause). One-click
            unpause for operator override. */}
        <RateLimitBanner />
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

// V107.14 — DaemonOutdatedBanner removed. The full-area
// DaemonOutdatedPanel + AutoUpdateFlow is the single recovery
// surface. See lib/version.ts REQUIRED_DAEMON_FEATURES + state/daemon.ts
// outdated computation for the unified trigger.

/** py-1.10.27 — Quota / rate-limit pause banner.
 *  Reads from `/health.quota` (per-key state — preferred) and falls
 *  back to `/health.paused_agent_types` (back-compat for daemons that
 *  haven't been upgraded yet). One row per paused quota_key:
 *     `<platform>/<model> · until HH:MM · retried Nx · Unpause`
 *  Unpause button posts to the daemon endpoint that matches the data
 *  source (quota_key → /quota/<key>/unpause; agent_type → /agent-types/<t>/unpause).
 */
interface PausedRow {
  label: string;            // what we show ("claude-code/auto" or agent_type fallback)
  unpauseUrl: string;       // server-relative path to post to
  expires_at: string;
  reason?: string;
  consecutive: number;
  last_probe?: string;
}
function RateLimitBanner() {
  const paused = createMemo<PausedRow[]>(() => {
    const h = daemonHealth() as {
      quota?: Record<string, {
        paused?: boolean;
        platform?: string;
        model?: string;
        paused_until?: string;
        reason?: string;
        consecutive_rate_limits?: number;
        probes?: Array<{ at?: string; outcome?: string }>;
      }>;
      paused_agent_types?: Record<string, {
        expires_at?: string;
        reason?: string;
        quota_key?: string;
        consecutive_rate_limits?: number;
      }>;
    } | null;
    const out: PausedRow[] = [];
    // Prefer /health.quota — it's the canonical per-key view.
    const q = h?.quota;
    if (q && typeof q === 'object') {
      for (const [key, entry] of Object.entries(q)) {
        if (!entry?.paused) continue;
        const probes = entry.probes ?? [];
        const last = probes[probes.length - 1];
        out.push({
          label: key,
          unpauseUrl: `/quota/${key}/unpause`,
          expires_at: String(entry.paused_until ?? ''),
          reason: entry.reason,
          consecutive: Number(entry.consecutive_rate_limits ?? 0),
          last_probe: last ? `${String(last.at ?? '').slice(11, 16)} → ${last.outcome ?? '?'}` : undefined,
        });
      }
      return out;
    }
    // Back-compat fallback (daemon < py-1.10.27).
    const legacy = h?.paused_agent_types;
    if (legacy && typeof legacy === 'object') {
      for (const [type, entry] of Object.entries(legacy)) {
        out.push({
          label: entry.quota_key ?? type,
          unpauseUrl: `/agent-types/${type}/unpause`,
          expires_at: String(entry.expires_at ?? ''),
          reason: entry.reason,
          consecutive: Number(entry.consecutive_rate_limits ?? 0),
        });
      }
    }
    return out;
  });
  const unpause = async (path: string): Promise<void> => {
    const client = daemonStore.state.client;
    if (!client) return;
    try {
      await fetch(`${client.transport.httpBase}${path}`, {
        method: 'POST',
        headers: client.transport.token
          ? { Authorization: `Bearer ${client.transport.token}` }
          : {},
        body: JSON.stringify({}),
      });
      log.info('[rate-limit] unpause requested', { path });
    } catch (e) {
      log.warn('[rate-limit] unpause failed', e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Show when={paused().length > 0}>
      <div class="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-sm">
        <div class="flex items-start gap-3">
          <span class="text-rose-300 text-lg leading-none" aria-hidden="true">⏸</span>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-rose-200">
              {paused().length === 1 ? 'Quota pool paused — rate-limited' : `${paused().length} quota pools paused — rate-limited`}
            </p>
            <p class="text-rose-100/75 text-xs mt-1 leading-relaxed">
              Dispatches against these pools will return 503 until the cooldown expires. The daemon's
              QuotaProber re-checks each one every ~minute and auto-unpauses when the upstream window resets.
            </p>
            <div class="mt-3 space-y-1.5">
              <For each={paused()}>
                {(p) => (
                  <div class="flex flex-wrap items-center gap-2 text-xs text-rose-100/80">
                    <code class="font-mono px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-100">{p.label}</code>
                    <span class="text-gray-400">until</span>
                    <span class="font-mono text-rose-200">{p.expires_at.slice(11, 16) || p.expires_at}</span>
                    <Show when={p.consecutive > 1}>
                      <span class="text-amber-300/80 font-mono">×{p.consecutive}</span>
                    </Show>
                    <Show when={p.last_probe}>
                      <span class="text-gray-500 font-mono">probe@{p.last_probe}</span>
                    </Show>
                    <Show when={p.reason}>
                      <span class="text-gray-500 truncate">· {p.reason}</span>
                    </Show>
                    <button
                      type="button"
                      onClick={() => { void unpause(p.unpauseUrl); }}
                      class="ml-auto px-2 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-wider border bg-rose-500/15 hover:bg-rose-500/30 text-rose-200 border-rose-500/40"
                    >
                      Unpause now
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
