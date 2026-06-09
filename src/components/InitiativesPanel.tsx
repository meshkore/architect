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
  type ServerInitiative,
  type ServerTask,
} from '~/state/server';
import InitiativeCard from '~/components/InitiativeCard';
import EmptyOnboardingPanel from '~/components/EmptyOnboardingPanel';
import { viewStore } from '~/state/view';
import { chatStore } from '~/state/chat';
import { daemonStore, daemonHealth } from '~/state/daemon';
import { runArchitectOnScope, stopArchitect } from '~/lib/architect-dispatch';
import { log } from '~/lib/log';

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
  // Accordion — only one story open at a time. `null` means all collapsed.
  const [openId, setOpenId] = createSignal<string | null>(null);
  const toggleOpen = (id: string) => setOpenId((cur) => (cur === id ? null : id));

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
  const architectExists = () => archCandidates().length > 0;
  const activeArchConv = (): string | null => archCandidates()[0] ?? null;
  const architectLive = createMemo<boolean>(() => {
    const conv = activeArchConv();
    if (!conv) return false;
    const s = chatStore.state.convs[conv];
    return !!s && (s.live || s.coordinating);
  });

  const anyStoryRunLive = createMemo<boolean>(() => {
    const archConv = activeArchConv();
    for (const c of Object.values(chatStore.state.convs)) {
      if (!c.live && !c.coordinating) continue;
      if (c.conv === archConv) continue;
      return true;
    }
    return false;
  });

  const onRunAll = async (): Promise<void> => {
    if (architectLive()) { await stopArchitect(); return; }
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
        <div class="rt-wrap">
          <header class="initiatives-header rt-header">
            <span class="rt-h-title">Initiatives</span>
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
                    ? 'Stop the running Roadmap Architect'
                    : anyStoryRunLive()
                      ? 'Hay otras iniciativas en marcha. Páralas primero.'
                      : filtered().length === 0
                        ? 'No hay iniciativas elegibles para Run all'
                        : architectExists()
                          ? 'Resume the existing Roadmap Architect over the visible scope'
                          : 'Spawn a Roadmap Architect agent over the visible roadmap'
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

          <RateLimitBanner />

          <Show
            when={filtered().length > 0}
            fallback={<NoMatch totalInitiatives={allInitiatives().length} />}
          >
            <div class="rt-timeline">
              <span class="rt-line" aria-hidden="true" />
              <ul style={{ 'list-style': 'none', margin: 0, padding: 0 }}>
                <For each={filtered()}>
                  {(it, i) => {
                    const isExitingNow = () => exiting().has(it.id);
                    const isOpen = () => openId() === it.id;
                    const isDimmed = () => openId() !== null && openId() !== it.id;
                    return (
                      <div
                        style={{
                          'transition-duration': `${EXIT_ANIM_MS}ms`,
                          'max-height': isExitingNow() ? '0px' : '6000px',
                          opacity: isExitingNow() ? '0' : '1',
                          overflow: 'hidden',
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
