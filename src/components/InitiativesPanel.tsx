/**
 * InitiativesPanel — V108 timeline rewrite.
 *
 * Renders the roadmap as a vertical timeline (one node per initiative)
 * on a near-black canvas. Click a story to expand its tasks; other
 * stories dim. The node ● is the run/stop control. Pre-V108 version
 * preserved as InitiativesPanel.legacy.tsx.bak.
 *
 * Behavior preserved 1:1 from the legacy version:
 *   - Visibility filter (active · archived · all · backlog)
 *   - Query filter
 *   - Run All architect (V92) with multi-spawn guard (V98)
 *   - Auto-archive on all-tasks-done (V106.3)
 *   - Stale-archive-shadow cleanup (V107.29)
 *   - Rate-limit / paused-quota banner
 *
 * Visual rewrite ONLY — see styles/roadmap-timeline.css.
 */

import { For, Show, createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import {
  allInitiatives,
  allTasks,
  isProjectEmpty,
  activeEntriesByInitiative,
  type ServerInitiative,
  type ServerTask,
} from '~/state/server';
import InitiativeCard, { expandAllTaskRows, collapseAllTaskRows } from '~/components/InitiativeCard';
import EmptyOnboardingPanel from '~/components/EmptyOnboardingPanel';
import { viewStore } from '~/state/view';
import { chatStore } from '~/state/chat';
import { daemonStore, daemonHealth } from '~/state/daemon';
import { runArchitectOnScope, stopArchitect } from '~/lib/architect-dispatch';
import { isQueued, queuedIds, clearQueue, setQueue } from '~/lib/queue';
import { log } from '~/lib/log';

type VisibilityFilter = 'all' | 'active' | 'backlog' | 'archived' | 'queue';

// Order requested by operator 2026-06-19: all · active · backlog · archived.
// QUEUE is rendered as a distinct chip after these (the live execution wall).
const VISIBILITY_FILTERS: { id: VisibilityFilter; label: string; title: string }[] = [
  { id: 'all',      label: 'all',      title: 'Everything — active, archived, completed, backlog, mixed' },
  { id: 'active',   label: 'active',   title: 'Initiatives in flight or up next — the operative roadmap' },
  { id: 'backlog',  label: 'backlog',  title: 'Ideas parked outside the active roadmap' },
  { id: 'archived', label: 'archived', title: 'Initiatives the operator manually archived' },
];

export default function InitiativesPanel() {
  const [visibility, setVisibility] = createSignal<VisibilityFilter>('active');
  const [query, setQuery] = createSignal('');
  // Two-step confirm for the queue Reset (no destructive one-click wipe).
  const [confirmingReset, setConfirmingReset] = createSignal(false);
  // Accordion — only one story open at a time. `null` means all collapsed.
  // `expandAll` overrides: when true, every story is open (and every task
  // row is opened too, via expandAllTaskRows) so the operator can read the
  // full history end-to-end. Toggled from the header.
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [expandAll, setExpandAll] = createSignal(false);
  const toggleOpen = (id: string) => {
    if (expandAll()) setExpandAll(false);
    setOpenId((cur) => (cur === id ? null : id));
  };
  const onExpandAll = () => {
    setExpandAll(true);
    setOpenId(null);
    expandAllTaskRows(allTasks().map((t) => t.id));
  };
  const onCollapseAll = () => {
    setExpandAll(false);
    setOpenId(null);
    collapseAllTaskRows();
  };

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
    const liveByInit = activeEntriesByInitiative();
    const matchesQuery = (it: ServerInitiative): boolean => {
      if (!q) return true;
      return `${it.title} ${it.id} ${it.oneliner ?? ''}`.toLowerCase().includes(q);
    };
    // QUEUE — the ephemeral, in-memory execution list (NOT a wall). Items
    // here are still wherever they live on the roadmap; this is just "what
    // will run". Base order = the operator's insertion order; live-but-not-
    // queued initiatives are appended so a running item stays visible; and
    // anything freshly anchor-created (within its NEW-badge TTL) is included
    // even if it briefly isn't live yet.
    //
    // THEN: imminent items — running RIGHT NOW or just created on the fly —
    // float to the TOP. Before the queue wall existed this "fresh at the top"
    // behaviour lived on the ACTIVE roadmap (scroll + ✨); it was lost when the
    // queue became the operator's execution view. (stable sort keeps the
    // within-band order: queued-insertion, then appended.)
    if (vis === 'queue') {
      const order = queuedIds();
      const inQ = new Set(order);
      const byId = new Map(allInitiatives().map((it) => [it.id, it] as const));
      const seen = new Set<string>();
      const out: ServerInitiative[] = [];
      const add = (it: ServerInitiative | undefined): void => {
        if (it && !seen.has(it.id) && matchesQuery(it)) {
          seen.add(it.id);
          out.push(it);
        }
      };
      for (const id of order) add(byId.get(id));
      for (const it of allInitiatives()) {
        if (inQ.has(it.id)) continue;
        const isLive = (liveByInit[it.id]?.length ?? 0) > 0;
        const isFresh = viewStore.isRecentlyCreatedInit(it.id);
        if (isLive || isFresh) add(it);
      }
      const imminent = (it: ServerInitiative): boolean =>
        (liveByInit[it.id]?.length ?? 0) > 0 ||
        viewStore.isRecentlyCreatedInit(it.id);
      return out.slice().sort((a, b) => Number(imminent(b)) - Number(imminent(a)));
    }

    const list = allInitiatives().filter((it) => {
      const isDone = it.status === 'done';
      const isArchManual = viewStore.isInitiativeArchived(it.id) && it.status !== 'active';
      const isArchived = isDone || isArchManual;
      const tasks = tbi.get(it.id) ?? [];
      const complete = tasks.length > 0 && tasks.every((t) => t.status === 'done');
      const isBacklog = it.status === 'backlog';
      if (vis === 'active') {
        if (exitingSet.has(it.id)) {
          // animating out — keep visible
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

    if (vis === 'archived') {
      return list.slice().sort((a, b) => {
        const ca = String(a.completed_at ?? '');
        const cb = String(b.completed_at ?? '');
        if (!ca && !cb) return 0;
        if (!ca) return 1;
        if (!cb) return -1;
        return cb.localeCompare(ca);
      });
    }
    return list;
  });

  // ── Auto-archive freshly-completed initiatives (V106.3 logic kept) ──
  const pendingTimers = new Map<string, number>();
  const isStillCompleteAndUnarchived = (id: string): boolean => {
    if (viewStore.isInitiativeArchived(id)) return false;
    const tasks = tasksByInitiative().get(id) ?? [];
    if (tasks.length === 0) return false;
    return tasks.every((t) => t.status === 'done');
  };

  // Stale archive shadow cleanup (V107.29 logic kept)
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
      const id = it.id;
      const t = window.setTimeout(() => {
        if (!isStillCompleteAndUnarchived(id)) {
          pendingTimers.delete(id);
          return;
        }
        setExiting((s) => { const n = new Set(s); n.add(id); return n; });
        const t2 = window.setTimeout(() => {
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

  // ── Run All / Stop architect — same wiring as legacy ──
  const archCandidates = createMemo<string[]>(() =>
    Object.values(chatStore.state.convs)
      .filter((c) => {
        if (c.archived) return false;
        if (c.agent_type === 'roadmap-architect') return true;
        if (c.conv.startsWith('roadmap-architect-')) return true;
        return false;
      })
      .sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''))
      .map((c) => c.conv),
  );
  const activeArchConv = (): string | null => archCandidates()[0] ?? null;
  const architectLive = createMemo<boolean>(() => {
    const conv = activeArchConv();
    if (!conv) return false;
    const s = chatStore.state.convs[conv];
    if (s && (s.live || s.coordinating)) return true;
    // COHERENCE FIX — mirror ChatScopeStrip.isWorking's fallback. The chat's
    // STOP button shows whenever there's a streaming assistant bubble in the
    // local convMap, even before the daemon snapshot's `live` flag lands. The
    // queue bar must read the SAME truth, otherwise the chat says "running +
    // STOP" while this bar still offers "▶ Ejecutar cola" (the incoherence the
    // operator hit). So check the streaming bubble too.
    const msgs = chatStore.state.convMap[conv] ?? [];
    const last = msgs[msgs.length - 1];
    return !!(last && last.kind === 'assistant' && last.streaming && !last.cancelled);
  });

  // ── Execution queue — derived state ─────────────────────────────────
  /** Initiatives in the queue (operator insertion order) PLUS anything
   *  live-but-not-queued, appended. Source of truth for the bar + run. */
  const queueInitiatives = createMemo<ServerInitiative[]>(() => {
    const order = queuedIds();
    const inQ = new Set(order);
    const byId = new Map(allInitiatives().map((it) => [it.id, it] as const));
    const live = activeEntriesByInitiative();
    const out: ServerInitiative[] = [];
    for (const id of order) { const it = byId.get(id); if (it) out.push(it); }
    for (const it of allInitiatives()) {
      if (!inQ.has(it.id) && (live[it.id]?.length ?? 0) > 0) out.push(it);
    }
    return out;
  });

  // Auto-prune: an initiative that finished (all tasks done, or status
  // done) leaves the queue — "execute → it's done → it's gone". Pure list
  // hygiene; nothing on the roadmap is touched here.
  createEffect(() => {
    const order = queuedIds();
    if (order.length === 0) return;
    const byId = new Map(allInitiatives().map((it) => [it.id, it] as const));
    const tbi = tasksByInitiative();
    const keep = order.filter((id) => {
      const it = byId.get(id);
      if (!it) return true; // unknown (snapshot lag) — keep, don't drop blindly
      const tasks = tbi.get(id) ?? [];
      const complete = tasks.length > 0 && tasks.every((t) => t.status === 'done');
      return it.status !== 'done' && !complete;
    });
    if (keep.length !== order.length) setQueue(keep);
  });
  /** Aggregate task progress across the whole wall (done / total). */
  const queueProgress = createMemo<{ done: number; total: number; pct: number }>(() => {
    const tbi = tasksByInitiative();
    let done = 0;
    let total = 0;
    for (const it of queueInitiatives()) {
      const tasks = tbi.get(it.id) ?? [];
      total += tasks.length;
      done += tasks.filter((t) => t.status === 'done').length;
    }
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  });

  // "Ejecutar cola" — run exactly what the operator staged (a curated
  // subset), in roadmap order, skipping anything already complete.
  const onRunQueue = async (): Promise<void> => {
    const list = queueInitiatives().filter((it) => {
      if (viewStore.isInitiativeArchived(it.id)) return false;
      const tasks = tasksByInitiative().get(it.id) ?? [];
      return tasks.some((t) => t.status !== 'done' && t.status !== 'cancelled');
    });
    if (list.length === 0) return;
    await runArchitectOnScope({
      initiatives: list.map((it) => ({ id: it.id, title: it.title })),
      display: list.length === 1 ? 'single' : 'subset',
    });
  };

  return (
    <section class="initiatives-section min-w-0 px-4 pt-1 pb-4">
      <Show when={!isProjectEmpty()} fallback={<EmptyOnboardingPanel />}>
        <div class="rt-wrap">
          <header class="initiatives-header rt-header">
            <div class="initiatives-filters flex items-center flex-shrink-0">
              {/* QUEUE FIRST — the live, operator-managed execution wall.
                  It is NOT part of the task catalog, so it sits apart (cyan
                  accent + a ~36px gap before the status filters). */}
              <button
                type="button"
                onClick={() => setVisibility('queue')}
                class={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors inline-flex items-center gap-1.5 ${
                  visibility() === 'queue'
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                    : 'text-gray-500 hover:text-cyan-300 border border-transparent'
                }`}
                title="Cola de ejecución — historias en cola o ejecutándose ahora"
              >
                queue
                <Show when={queueInitiatives().length > 0}>
                  <span class="rt-queue-count">{queueInitiatives().length}</span>
                </Show>
              </button>
              <span class="rt-filter-sep" aria-hidden="true" />
              {/* The status-catalog filters. */}
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
            </div>
            {/* Expand-all / collapse-all — open every story AND every
                task body so the operator can read the whole history
                without clicking through. */}
            <div class="rt-expand-group ml-auto flex items-center gap-0.5 flex-shrink-0">
              <button
                type="button"
                onClick={onExpandAll}
                class="rt-expand-btn"
                title="Expandir todas las historias y tareas — leer todo de un vistazo"
                aria-label="Expand all"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
                  stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M7 9l5-5 5 5" />
                  <path d="M7 15l5 5 5-5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onCollapseAll}
                class="rt-expand-btn"
                title="Plegar todas las historias y tareas"
                aria-label="Collapse all"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
                  stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M7 4l5 5 5-5" />
                  <path d="M7 20l5-5 5 5" />
                </svg>
              </button>
            </div>
            <input
              type="text"
              placeholder="Filter…"
              value={query()}
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
              class="initiatives-filter-input bg-gray-800/70 border border-gray-600 rounded-md px-3 py-1 text-xs text-gray-100 placeholder-gray-400 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/40 w-44 min-w-0"
            />
            {/* RUN ALL removed 2026-06-19 — redundant with the queue's
                "Ejecutar cola"; execution now happens only from the Queue
                wall. Staging is per-story ▶. */}
          </header>

          <RateLimitBanner />

          {/* Queue wall control bar — progress + run/stop/clear. */}
          <Show when={visibility() === 'queue'}>
            <div class="rt-queuebar">
              <div
                class="rt-qbar-progress"
                title={`${queueProgress().done}/${queueProgress().total} tareas completadas`}
              >
                <span class="rt-qbar-fill" style={{ width: `${queueProgress().pct}%` }} />
              </div>
              <span class="rt-qbar-stat">
                {queueProgress().done}/{queueProgress().total} tareas · {queueInitiatives().length} en cola
              </span>
              <div class="ml-auto flex items-center gap-2 flex-shrink-0">
                {/* Coherent with the chat's STOP: while the architect runs we
                    show a "running" pill + the Parar button (NOT an enabled
                    play). When idle, the play button runs the queue. */}
                <Show
                  when={!architectLive()}
                  fallback={
                    <span class="rt-qbtn rt-qbtn-running" title="La cola se está ejecutando — el Roadmap Architect está trabajando">
                      <span class="rt-qbar-spinner" aria-hidden="true" /> En curso…
                    </span>
                  }
                >
                  <button
                    type="button"
                    onClick={() => { void onRunQueue(); }}
                    disabled={queueInitiatives().length === 0}
                    class="rt-qbtn rt-qbtn-run"
                    title="Ejecutar las historias en cola, en orden"
                  >
                    ▶ Ejecutar cola
                  </button>
                </Show>
                <Show when={architectLive()}>
                  <button
                    type="button"
                    onClick={() => { void stopArchitect(); }}
                    class="rt-qbtn rt-qbtn-stop"
                    title="Parar la ejecución en curso"
                  >
                    ⏹ Parar
                  </button>
                </Show>
                <Show
                  when={!confirmingReset()}
                  fallback={
                    <span class="inline-flex items-center gap-1.5">
                      <span class="rt-qbar-stat">¿Vaciar la cola?</span>
                      <button
                        type="button"
                        class="rt-qbtn rt-qbtn-stop"
                        onClick={() => { clearQueue(); setConfirmingReset(false); }}
                      >Sí</button>
                      <button
                        type="button"
                        class="rt-qbtn rt-qbtn-clear"
                        onClick={() => setConfirmingReset(false)}
                      >No</button>
                    </span>
                  }
                >
                  <button
                    type="button"
                    onClick={() => setConfirmingReset(true)}
                    disabled={queueInitiatives().length === 0}
                    class="rt-qbtn rt-qbtn-clear"
                    title="Vaciar la cola (pide confirmación; no afecta a lo que ya se está ejecutando)"
                  >
                    Reset
                  </button>
                </Show>
              </div>
            </div>
          </Show>

          <Show
            when={filtered().length > 0}
            fallback={
              visibility() === 'queue'
                ? <QueueEmpty />
                : <NoMatch totalInitiatives={allInitiatives().length} />
            }
          >
            <div class="rt-timeline">
              <span class="rt-line" aria-hidden="true" />
              <ul style={{ 'list-style': 'none', margin: 0, padding: 0 }}>
                <For each={filtered()}>
                  {(it, i) => {
                    const isExitingNow = () => exiting().has(it.id);
                    const isOpen = () => expandAll() || openId() === it.id;
                    const isDimmed = () => !expandAll() && openId() !== null && openId() !== it.id;
                    return (
                      <div
                        style={{
                          'transition-duration': `${EXIT_ANIM_MS}ms`,
                          'max-height': isExitingNow() ? '0px' : '6000px',
                          opacity: isExitingNow() ? '0' : '1',
                          // Operator 2026-06-10: when the wrapper is just
                          // hosting a visible card, let the node's halo +
                          // hover scale extend freely (`visible`). Only
                          // clip during the EXIT animation so the
                          // max-height transition reads cleanly.
                          overflow: isExitingNow() ? 'hidden' : 'visible',
                          transition: 'all .35s ease',
                        }}
                      >
                        <InitiativeCard
                          initiative={it}
                          tasks={tasksByInitiative().get(it.id) ?? []}
                          index={i() + 1}
                          isOpen={isOpen()}
                          isDimmed={isDimmed()}
                          onToggle={() => toggleOpen(it.id)}
                          archived={visibility() === 'archived'}
                        />
                      </div>
                    );
                  }}
                </For>
              </ul>
            </div>
          </Show>

          <p class="text-xs text-gray-600 mt-6">
            {filtered().length} of {allInitiatives().length} initiatives · {allTasks().length} tasks · live from daemon
          </p>
        </div>
      </Show>
    </section>
  );
}

function QueueEmpty() {
  return (
    <div class="text-center py-16 text-gray-500">
      <p class="text-sm">La cola está vacía.</p>
      <p class="text-xs text-gray-600 mt-2">
        Pulsa <span class="text-cyan-300/80">＋</span> en una historia <span class="text-amber-300/80">active</span> para añadirla a la cola; luego <span class="text-cyan-300/80">Ejecutar cola</span>. La cola es temporal — no mueve nada del roadmap.
      </p>
    </div>
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

// ── Rate-limit banner (unchanged from legacy) ─────────────────────────
interface PausedRow {
  label: string;
  unpauseUrl: string;
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
