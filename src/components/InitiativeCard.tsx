/**
 * InitiativeCard — V86h.
 *
 * Header shows: run button · TITLE · status · module count · progress
 * pill · expand chevron. The all-caps slug chip (e.g. "DAEMON-RUNTIME")
 * was removed from the header because the title already says it in
 * human form — having both side-by-side felt duplicated. The slug
 * still lives on the expanded card so the operator can copy it for
 * chat references.
 *
 * Expanded body, in order:
 *   1. Description: one-line preview (oneliner) + "more" button that
 *      reveals the long-form `body` (markdown source rendered as
 *      plain text for now). Click "less" to collapse.
 *   2. Tasks: ALWAYS grouped by phase. The "Group by phase" checkbox
 *      was removed — phases are the only sensible ordering for a
 *      foundation → build → docs → ship pipeline. The persisted
 *      `groupByPhase` flag in viewStore is dead code we keep for
 *      backwards-compat with older localStorage payloads.
 */

import { For, Show, createMemo, createResource } from 'solid-js';
import type { ServerInitiative, ServerTask } from '~/state/server';
import { activeEntriesByInitiative } from '~/state/server';
import { sortTasks, groupByPhases } from '~/components/initiative/task-grouping';
import { TaskGrid, StatusBadge } from '~/components/initiative/TaskGrid';
import { chatStore } from '~/state/chat';
import { viewStore } from '~/state/view';
import { daemonStore } from '~/state/daemon';
import { runArchitectOnScope, stopArchitect } from '~/lib/architect-dispatch';
import { parseInitiativeBody } from '~/lib/task-id';
import StoryProgressPill from '~/components/story/StoryProgressPill';

const DESCRIPTION_PREVIEW_CHARS = 220;

export default function InitiativeCard(props: { initiative: ServerInitiative; tasks: ServerTask[] }) {
  const expanded = () => viewStore.isInitiativeExpanded(props.initiative.id);
  const setExpanded = (v: boolean) => viewStore.setInitiativeExpanded(props.initiative.id, v);
  const descExpanded = () => viewStore.isDescriptionExpanded(props.initiative.id);
  const toggleDesc = () => viewStore.toggleDescription(props.initiative.id);

  const sorted = createMemo(() => sortTasks(props.tasks));
  const done = createMemo(() => props.tasks.filter((t) => t.status === 'done').length);
  // V89.3 — initiative is "complete" when it has at least one task
  // and every task is done. Used to swap the play button for a
  // subtle check mark, and to hide the row from the default
  // visibility=active list (InitiativesPanel filters on this).
  const isComplete = createMemo(() => props.tasks.length > 0 && done() === props.tasks.length);

  const modules = createMemo<string[]>(() => {
    const m = new Set<string>();
    for (const t of props.tasks) {
      if (t.module) m.add(t.module);
      else if (t.category) m.add(t.category);
    }
    return [...m];
  });

  const grouped = createMemo<[string, ServerTask[]][]>(() => groupByPhases(sorted()));

  /** V107.22 — Initiative body fetcher. The daemon's /state payload
   *  exposes `path` but not `body` for initiatives (avoiding payload
   *  bloat across N initiatives). Fetch the markdown on demand from
   *  the same path served as a static file. Parse `## Description`
   *  section for the collapsible operator-readable description; fall
   *  back to the inline `oneliner` + legacy `body` field if no
   *  Description block is declared.
   *
   *  createResource keyed on (client, path) so it refetches when the
   *  operator swaps clusters or the file is touched. */
  const [bodyRes] = createResource<string, { path: string }>(
    () => {
      const client = daemonStore.state.client;
      const path = props.initiative.path;
      if (!client || !path) return null;
      return { path };
    },
    async (input) => {
      const client = daemonStore.state.client;
      if (!client) return '';
      const r = await client.readMarkdownFile(input.path);
      return r.ok ? r.body : '';
    },
  );
  const parsed = createMemo(() => parseInitiativeBody(bodyRes() ?? ''));
  /** Computed description preview/full state. New convention: the
   *  `## Description` block in the body. Legacy: `oneliner` (short
   *  hook in frontmatter) + ServerInitiative.body (used to be set,
   *  now always empty — kept for back-compat). */
  const oneliner = (): string => (props.initiative.oneliner ?? '').trim();
  const description = (): string => {
    const d = parsed().description;
    if (d) return d;
    const legacyBody = (props.initiative.body ?? '').trim();
    if (legacyBody) return legacyBody;
    return oneliner();
  };
  const hasDescription = (): boolean => description().length > 0;
  const hasMore = (): boolean => {
    const d = description();
    if (!d) return false;
    return d.length > DESCRIPTION_PREVIEW_CHARS || d.split('\n').length > 3;
  };

  // py-1.12.0-cockpit — Per-initiative play now routes through the
  // SAME architect entrypoint as Run All (`runArchitectOnScope`). One
  // code path, one conv per cluster, one set of state derivations.
  // The old storyStore-based path (story-<initId> convs via /runs)
  // is dead — it ran in parallel to the architect, duplicated state,
  // and was the source of "play turned amber but nothing happened"
  // (a paused story-run with no actual progress).
  //
  // States this card surfaces, in order of precedence:
  //   • isWorking      — the architect has live subagents on THIS
  //                       initiative (spinner + STOP)
  //   • otherActivityLive — the architect is busy on a DIFFERENT
  //                       initiative OR Run All is running elsewhere
  //                       (disabled + tooltip)
  //   • idle           — ▶ Run initiative

  /** Live agents working on THIS initiative right now. Derived from
   *  the daemon-authoritative `activeEntriesByInitiative` (WS
   *  conv.activity). When the operator clicks ▶ on this card the
   *  architect itself shows up here first (it's dispatched with
   *  initiative_id=<this>) — and only later, after it reads + plans,
   *  do the work-* subagents appear. We split the two so the UI can
   *  tell the operator "preparing…" vs "task in flight". */
  const liveAgentsHere = createMemo(
    () => activeEntriesByInitiative()[props.initiative.id] ?? [],
  );
  const isWorking = (): boolean => liveAgentsHere().length > 0;
  const liveWorkersHere = createMemo(
    () => liveAgentsHere().filter((e) => e.conv.startsWith('work-')),
  );
  /** py-1.12.0-cockpit — TRUE while the architect is live/coordinating
   *  on this initiative but has not dispatched a worker yet. Real-world
   *  gap: 5-20s between ▶ click and the first `work-*` going live,
   *  during which the card looked idle even though the architect was
   *  reading frontmatters + planning. Drives the "preparing dispatch"
   *  banner that pulses inside the expanded card. */
  const isPreparing = (): boolean =>
    isWorking() && liveWorkersHere().length === 0;

  /** True iff something else in the cluster is live AND it's not on
   *  this initiative. Includes the architect's own runner (`live`)
   *  and any coordinating parent waiting on children. */
  const otherActivityLive = createMemo<boolean>(() => {
    for (const c of Object.values(chatStore.state.convs)) {
      if (!c.live && !c.coordinating) continue;
      if (c.initiative_id === props.initiative.id) continue;
      return true;
    }
    return false;
  });

  /** ▶ click handler. Three branches:
   *    1. Already working on this → stop the architect (cancels its turn).
   *    2. Other activity live → no-op (button is disabled anyway).
   *    3. Idle → dispatch the architect on this initiative only.
   *  All three reuse the cluster's single architect conv. */
  const toggleRun = (): void => {
    if (isWorking()) {
      void stopArchitect();
      return;
    }
    if (otherActivityLive()) return;
    void runArchitectOnScope({ mode: 'single', initiative: props.initiative });
  };

  // V86w — archive / unarchive lives in viewStore (per-cluster
  // localStorage). When the operator archives an initiative the
  // panel's `visibility` filter hides it from the active list — the
  // initiative still exists, can be unarchived, and reappears on
  // demand.
  //
  // V107.29 — Daemon is authoritative for `active`. If the daemon
  // says `status: active`, the local shadow is suppressed (same rule
  // as InitiativesPanel filter). Prevents a stale shadow from
  // hiding a card the daemon currently considers active.
  const isArchived = () =>
    viewStore.isInitiativeArchived(props.initiative.id) && props.initiative.status !== 'active';
  const toggleArchive = (e: MouseEvent): void => {
    e.stopPropagation();
    viewStore.setInitiativeArchived(props.initiative.id, !isArchived());
  };

  // V86w — Detail tab inside the expanded card. Defaults to 'tasks';
  // 'activity' fetches /initiative/<id>/activity (commits + files).
  const tab = () => viewStore.initiativeTab(props.initiative.id);
  const setTab = (t: 'tasks' | 'activity') => viewStore.setInitiativeTab(props.initiative.id, t);

  // V107.7 — Brighter border when the card is expanded so the
  // operator can see where the card starts and ends. Archived
  // initiatives keep their amber accent; expanded gets emerald
  // accent + a soft inner ring; collapsed stays subtle.
  const articleCls = (): string => {
    const base = 'bg-gray-900/40 border rounded-lg overflow-hidden transition-colors';
    if (isArchived()) return `${base} border-amber-500/25 opacity-70`;
    if (expanded()) return `${base} border-emerald-500/35 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.10)]`;
    return `${base} border-gray-700/60 hover:border-gray-600/70`;
  };
  return (
    <article class={articleCls()}>
      <header class="flex items-center gap-3 px-4 py-3">
        <Show
          when={!isComplete()}
          fallback={
            <span
              title="Initiative complete — all tasks done"
              aria-label="initiative complete"
              class="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 border border-emerald-500/30 bg-emerald-500/5 text-emerald-300/70"
            >
              {/* V89.3 — Simple "V" / check mark inside the same square
                  shape the play button uses. No circle, no fill — just
                  a subtle stroke so the operator scans "this one's
                  done" at a glance, especially under the ALL filter
                  where complete + pending live side by side. */}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
            </span>
          }
        >
          {/* py-1.11.0 — When live agents are working on this initiative
              (daemon-authoritative via chatStore.state.convs), the
              disabled play turns into an animated spinner so the
              operator sees activity at a glance. Tooltip + aria label
              name the agents. */}
          {/* py-1.12.0-cockpit — Single button that flips between three
              visual states depending on the daemon-authoritative live
              flags. Click is wired to `toggleRun`:
                • working → spinner + STOP affordance; click cancels
                  the architect's in-flight turn for this initiative
                • other-activity-live → grayed-out, disabled, tooltip
                  names the blocker
                • idle → ▶ green play; click dispatches the architect
                  on this initiative ONLY (mode='single'). */}
          <button
            type="button"
            onClick={toggleRun}
            disabled={!isWorking() && otherActivityLive()}
            title={
              isWorking()
                ? `Stop the architect — currently dispatching on this initiative (${liveAgentsHere().map((e) => e.agent_id || e.conv).join(' · ')})`
                : otherActivityLive()
                  ? 'Otra ejecución está en marcha en este cluster — páralas primero (Run All o la otra iniciativa)'
                  : 'Run initiative — dispatches the Roadmap Architect on this initiative only'
            }
            aria-label={
              isWorking()
                ? `Stop the run live on initiative ${props.initiative.id}`
                : `Run initiative ${props.initiative.id}`
            }
            class={`w-7 h-7 rounded-md flex items-center justify-center text-xs flex-shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:grayscale border relative ${
              isWorking()
                ? 'bg-emerald-500/15 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-300 text-emerald-200 border-emerald-500/50'
                : otherActivityLive()
                  ? 'bg-gray-700/30 text-gray-500 border-gray-700/50'
                  : 'bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
            }`}
          >
            <Show
              when={isWorking()}
              fallback={<span aria-hidden="true">▶</span>}
            >
              {/* Animated arc spinner — same shape Run All uses on the
                  header so the operator's eye reads "running" in 100ms. */}
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                class="animate-spin"
                style={{ 'animation-duration': '1.6s' }}
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </Show>
          </button>
        </Show>
        <button
          type="button"
          onClick={() => setExpanded(!expanded())}
          class="flex-1 flex items-center gap-3 min-w-0 text-left"
        >
          <h3 class="text-sm font-semibold text-gray-100 truncate">{props.initiative.title}</h3>
          <Show when={isArchived()}>
            <span class="font-mono text-[9px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 uppercase tracking-wider flex-shrink-0">
              archived
            </span>
          </Show>
          <Show when={props.initiative.status}>
            <StatusBadge status={props.initiative.status as string} />
          </Show>
          <Show when={modules().length > 1}>
            <span class="font-mono text-[10px] text-gray-500 uppercase tracking-wider flex-shrink-0">
              {modules().length} modules
            </span>
          </Show>
          <span class="ml-auto flex-shrink-0">
            <StoryProgressPill
              initiativeId={props.initiative.id}
              totalTasks={props.tasks.length}
              doneTasks={done()}
            />
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            class={`text-gray-600 flex-shrink-0 transition-transform ${expanded() ? 'rotate-180' : ''}`}>
            <path d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={toggleArchive}
          title={isArchived() ? 'Restore to active list' : 'Hide from active list'}
          class="w-7 h-7 rounded-md text-gray-500 hover:text-amber-300 border border-transparent hover:border-amber-500/40 flex items-center justify-center text-[10px] font-mono flex-shrink-0 transition-colors"
        >
          <Show when={!isArchived()} fallback={<span aria-hidden="true">↺</span>}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8" />
              <path d="M10 12h4" />
            </svg>
          </Show>
        </button>
      </header>

      {/* V107.22 — Description block lives ABOVE the expanded section
          now (operator request 2026-06-01: "el título y debajo debería
          tener la descripción limitada a un máximo de tres líneas
          visibles con el botón ver más o ver menos"). Always rendered
          when description text exists, regardless of card expansion. */}
      <Show when={hasDescription()}>
        <div class="border-t border-gray-800/60 px-4 py-3">
          <Description
            oneliner={oneliner()}
            body={description()}
            expanded={descExpanded()}
            toggleable={hasMore()}
            onToggle={toggleDesc}
            slug={props.initiative.id}
          />
        </div>
      </Show>

      <Show when={expanded()}>
        <div class="border-t border-gray-800/60 px-4 py-3 space-y-4">

          {/* V86w — detail tabs. `tasks` keeps the existing per-phase
              grid; `activity` surfaces git commits + files modified
              for this initiative (daemon py-1.9.3+). */}
          <div class="flex items-center gap-1 border-b border-gray-800/60 -mx-4 px-4 pb-1">
            <TabPill label="Tasks" active={tab() === 'tasks'} onClick={() => setTab('tasks')} />
            <TabPill label="Activity" active={tab() === 'activity'} onClick={() => setTab('activity')} />
          </div>

          <Show when={tab() === 'activity'} fallback={
            <Show when={props.tasks.length > 0} fallback={<NoTasks />}>
              {/* py-1.12.0-cockpit — "Preparing dispatch" banner. The
                  architect's first turn after a Run-initiative click
                  takes ~5-20s of file reads + planning before any
                  worker conv goes live. Without this banner the
                  operator sees a static task list and assumes nothing
                  is happening. The banner sits between the tabs and
                  the first phase header so it reads as "the whole
                  list is waiting on planning". */}
              <Show when={isPreparing()}>
                <div class="flex items-center gap-2 px-3 py-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] text-[11px] text-emerald-200 mb-3">
                  <span class="inline-flex items-center gap-0.5 flex-shrink-0" aria-hidden="true">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse-soft" />
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse-soft [animation-delay:150ms]" />
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse-soft [animation-delay:300ms]" />
                  </span>
                  <span class="font-medium">Architect preparing dispatch</span>
                  <span class="text-emerald-300/60">— reading task frontmatters, resolving <code class="font-mono">depends_on</code>, picking the first wave</span>
                </div>
              </Show>
              <For each={grouped()}>
                {([phase, tasks]) => (
                  <div class="mb-4 last:mb-0">
                    <div class="text-[10px] font-mono uppercase tracking-wider text-gray-600 border-b border-gray-800/60 pb-1 mb-2">
                      {phase}
                    </div>
                    <TaskGrid tasks={tasks} />
                  </div>
                )}
              </For>
            </Show>
          }>
            <ActivityTab initiativeId={props.initiative.id} />
          </Show>
        </div>
      </Show>
    </article>
  );
}

/**
 * Description — V107.33.
 *
 * Single paragraph of normal-weight grey prose, clamped to 2 lines
 * by default with a "+ show more" toggle. Picks the body if present
 * (the `## Description` block parsed out of the markdown file),
 * else falls back to the operator-authored `oneliner`. Pre-V107.33
 * we rendered BOTH stacked (oneliner in bold-white above, body in
 * grey below) which read as a duplicate header on most initiatives
 * because the agent tends to set oneliner = first sentence of body.
 *
 * Operator request 2026-06-05: titles up top, descriptions max 2
 * lines, normal weight (not bold).
 */
function Description(props: {
  oneliner: string;
  body: string;
  expanded: boolean;
  toggleable: boolean;
  onToggle: () => void;
  slug: string;
}) {
  // Body wins if present; oneliner is the back-compat fallback for
  // initiatives whose markdown file never gained a `## Description`
  // block.
  const text = (): string => {
    const b = props.body.trim();
    if (b) return b;
    return props.oneliner.trim();
  };
  const has = (): boolean => text().length > 0;
  // 2-line clamp via CSS so the truncation is responsive to width.
  // `isLong` is approximate (chars + newlines) — the toggle button
  // shows when EITHER metric trips. False positives are fine: an
  // empty expand simply shows the same text.
  const isLong = (): boolean => {
    const t = text();
    return t.length > 140 || t.split('\n').length > 2;
  };
  const collapsedStyle = {
    display: '-webkit-box',
    '-webkit-line-clamp': '2',
    '-webkit-box-orient': 'vertical',
    overflow: 'hidden',
  } as const;

  return (
    <div>
      <Show when={has()}>
        <p
          class="text-[12.5px] text-gray-400 leading-[1.55] whitespace-pre-wrap break-words"
          style={props.expanded ? {} : collapsedStyle}
        >
          {text()}
        </p>
        <Show when={isLong()}>
          <button
            type="button"
            onClick={props.onToggle}
            class="mt-2 text-[10px] font-mono uppercase tracking-wider text-emerald-300/70 hover:text-emerald-300 transition-colors"
          >
            {props.expanded ? '— show less' : '+ show more'}
          </button>
        </Show>
      </Show>
    </div>
  );
}

function NoTasks() {
  return (
    <p class="text-xs text-gray-600 italic py-2">No tasks linked to this initiative yet.</p>
  );
}

function TabPill(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`px-2.5 py-1 rounded-t text-[10px] font-mono uppercase tracking-wider transition-colors ${
        props.active
          ? 'text-emerald-300 border-b-2 border-emerald-500'
          : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'
      }`}
    >
      {props.label}
    </button>
  );
}

/**
 * V86w — Activity tab for an expanded initiative card. Fetches
 * `/initiative/<id>/activity` (py-1.9.3+) — git commits whose
 * subject/body mentions the initiative id, with the files each
 * commit touched. Multi-repo workspaces label each commit with its
 * repo slug so the operator can tell them apart.
 *
 * Daemons older than py-1.9.3 don't expose the endpoint; the
 * createResource error surfaces a "needs daemon py-1.9.3" notice
 * with the upgrade hint.
 */
function ActivityTab(props: { initiativeId: string }) {
  const [activity] = createResource(
    () => ({ id: props.initiativeId, client: daemonStore.state.client }),
    async (input) => {
      if (!input.client) throw new Error('no daemon client');
      const r = await input.client.initiativeActivity(input.id);
      if (!r.ok) throw new Error(r.error ?? `HTTP ${r.status}`);
      return r.data;
    },
  );
  const supported = () => (daemonStore.state.health?.features ?? []).includes('initiative.activity');

  return (
    <div class="space-y-2">
      <Show when={!supported()}>
        <div class="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
          Daemon doesn't expose <code class="font-mono">initiative.activity</code> yet — upgrade to <span class="font-mono">py-1.9.3</span> (apply protocol <span class="font-mono">P4</span>).
        </div>
      </Show>
      <Show when={supported() && activity.loading}>
        <p class="text-[11px] text-gray-500 font-mono">scanning git…</p>
      </Show>
      <Show when={supported() && activity.error}>
        <p class="text-[11px] text-red-400 font-mono">load failed — {String(activity.error)}</p>
      </Show>
      <Show when={supported() && activity()?.error}>
        <p class="text-[11px] text-gray-500 italic">{activity()?.error}</p>
      </Show>
      <Show when={supported() && activity() && (activity()!.commits.length === 0) && !activity()!.error}>
        <p class="text-[11px] text-gray-600 italic">
          No commits reference <code class="font-mono text-gray-400">{props.initiativeId}</code> yet. Commit messages that mention the id get picked up automatically.
        </p>
      </Show>
      <Show when={(activity()?.commits.length ?? 0) > 0}>
        <ul class="space-y-2.5">
          <For each={activity()!.commits}>
            {(c) => <CommitRow commit={c} />}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function CommitRow(props: { commit: import('~/lib/daemon-client').InitiativeActivityCommit }) {
  return (
    <li class="rounded border border-gray-800/60 bg-gray-900/40 px-3 py-2">
      <div class="flex items-center gap-2 text-[11px] font-mono mb-1 flex-wrap">
        <span class="text-emerald-300/90">{props.commit.short_sha}</span>
        <Show when={props.commit.repo}>
          <span class="text-gray-600 bg-gray-800/60 border border-gray-700/60 rounded px-1.5 py-0.5 uppercase tracking-wider text-[9px]">
            {props.commit.repo}
          </span>
        </Show>
        <span class="text-gray-500 truncate flex-1 min-w-0" title={props.commit.author}>
          {props.commit.author}
        </span>
        <time class="text-gray-600" dateTime={props.commit.ts}>
          {formatCommitTs(props.commit.ts)}
        </time>
      </div>
      <p class="text-[12px] text-gray-200 leading-snug mb-1.5">{props.commit.subject}</p>
      <Show when={props.commit.files.length > 0}>
        <details class="text-[10px] font-mono text-gray-500">
          <summary class="cursor-pointer hover:text-gray-300">
            {props.commit.files.length} file{props.commit.files.length === 1 ? '' : 's'}
            <Show when={props.commit.files_truncated}>
              <span class="text-amber-400/80"> (truncated)</span>
            </Show>
          </summary>
          <ul class="mt-1 space-y-0.5 max-h-48 overflow-y-auto">
            <For each={props.commit.files}>
              {(f) => <li class="text-gray-400 truncate" title={f}>{f}</li>}
            </For>
          </ul>
        </details>
      </Show>
    </li>
  );
}

// py-1.12.0-cockpit — `buildResumePrompt` was the storyStore-driven
// resume turn used when a story-run was paused mid-flight. That code
// path is gone (per-initiative play now routes through the
// architect, no separate run state machine). Kept here as a comment
// marker so anyone searching for "resume prompt" lands on the
// architect-dispatch decision instead of a missing function.

function formatCommitTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return ts;
  }
}
